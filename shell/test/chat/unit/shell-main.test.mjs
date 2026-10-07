// @ts-check
// The shell's main process, against the COMPILED output (build/main/*.js) — the same files the app
// runs. Docs review 2026-09-27, findings SA-1 … SA-6 and B-3. Electron is replaced by a stub in
// require's cache (the compiled modules only read app.getPath/isPackaged/getVersion from it), so
// nothing here starts a process, opens a socket or talks to a farm or to GitHub.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHELL = path.join(HERE, '..', '..', '..');
const BUILD = path.join(SHELL, 'build', 'main');
const SRC = path.join(SHELL, 'src', 'main');
const MODULES = ['farmSelect', 'discovery', 'configBridge', 'sidecar', 'sidecarManager', 'clientData', 'dataMigration', 'store', 'io', 'mcp', 'serial', 'webSearch'];
const WEB_FIXTURES = path.join(HERE, '..', 'fixtures', 'web');

/** @type {string[]} */
const temps = [];
const tempDir = (name) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `lol-shell-main-${name}-`));
  temps.push(d);
  return d;
};

// ---- the Electron stub -------------------------------------------------------------------------
const USER_DATA = tempDir('userdata');
const fakeApp = {
  isPackaged: false,
  getPath: (/** @type {string} */ name) => (name === 'temp' ? os.tmpdir() : USER_DATA),
  getVersion: () => '0.0.0-test',
  getAppPath: () => SHELL,
};
function stubElectron() {
  const resolved = require.resolve('electron', { paths: [BUILD] });
  require.cache[resolved] = /** @type {any} */ ({ id: resolved, filename: resolved, loaded: true, exports: { app: fakeApp } });
}

/** Run `fn` with some process.env entries set (undefined = unset), then put them back. */
async function withEnv(/** @type {Record<string, string|undefined>} */ vars, /** @type {() => any} */ fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k];
  }
  try { return await fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

/** A Hugging Face cache entry the way snapshot_download leaves it. */
function seedHf(/** @type {string} */ root, /** @type {string} */ repo) {
  const snap = path.join(root, repo, 'snapshots', '0123abcd');
  fs.mkdirSync(snap, { recursive: true });
  fs.writeFileSync(path.join(snap, 'config.json'), '{}');
}
const MINILM = 'models--sentence-transformers--all-MiniLM-L6-v2';
const WHISPER = 'models--Systran--faster-whisper-base';

/** A farm the way discovery hands it to index.ts. */
function farm(/** @type {Record<string, any>} */ o) {
  return {
    v: 1, id: o.id, name: o.id, proxyPort: 4000, httpPort: 41997, ips: [], endpoint: '', openaiBaseUrl: '',
    requiresKey: !!o.requiresKey, models: o.models || [{ id: 'gemma4:12b', default: true }], healthy: o.healthy !== false,
    version: 'x', ts: 0, _source: 'beacon', _host: o.host || `10.0.0.${o.n || 5}`, _lastSeen: 0, _stale: !!o.stale,
    ...(o.capacity ? { capacity: o.capacity } : {}),
    ...(o.extra || {}),
  };
}

export default (test) => {
  test('the compiled main modules are present and not stale', () => {
    for (const m of MODULES) {
      const built = path.join(BUILD, `${m}.js`);
      assert.ok(fs.existsSync(built), `missing ${built} — run: npm --prefix shell run build`);
      assert.ok(fs.statSync(built).mtimeMs >= fs.statSync(path.join(SRC, `${m}.ts`)).mtimeMs,
        `build/main/${m}.js is older than ${m}.ts — run: npm --prefix shell run build`);
    }
  });

  stubElectron();
  const FS = require(path.join(BUILD, 'farmSelect.js'));
  const { Discovery } = require(path.join(BUILD, 'discovery.js'));
  const CB = require(path.join(BUILD, 'configBridge.js'));
  const MCP = require(path.join(BUILD, 'mcp.js'));
  const { SidecarSupervisor } = require(path.join(BUILD, 'sidecar.js'));
  const SM = require(path.join(BUILD, 'sidecarManager.js'));
  const CD = require(path.join(BUILD, 'clientData.js'));
  const DM = require(path.join(BUILD, 'dataMigration.js'));
  const STORE = require(path.join(BUILD, 'store.js'));

  // ------------------------------------------------ the Computer as an MCP server (2026-09-27)
  test('MCP: initialize, tools/list and tools/call by JSON-RPC; a notification gets nothing; the tools carry their schema', async () => {
    const calls = [];
    const deps = { token: 't0k', version: '0.2.0', tools: () => MCP.TOOLS, call: async (name, args) => { calls.push([name, args]); return name === 'read_graph' ? { text: '{"boxes":[]}' } : { text: 'no', isError: true }; } };
    const init = await MCP.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, deps);
    assert.equal(init.result.serverInfo.name, 'llmonlan-computer');
    assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
    assert.equal(await MCP.handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, deps), null);
    const list = await MCP.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, deps);
    assert.ok(list.result.tools.length >= 9 && list.result.tools.every((t) => t.name && t.description && t.inputSchema && t.inputSchema.type === 'object'));
    const read = await MCP.handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_graph', arguments: {} } }, deps);
    assert.deepEqual(read.result, { content: [{ type: 'text', text: '{"boxes":[]}' }], isError: false });
    const refused = await MCP.handleRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'run_graph', arguments: {} } }, deps);
    assert.equal(refused.result.isError, true, 'a refusal is an error the model reads, not a protocol error');
    assert.equal((await MCP.handleRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'format_disk' } }, deps)).error.code, -32602);
    assert.equal((await MCP.handleRpc({ jsonrpc: '2.0', id: 6, method: 'resources/list' }, deps)).error.code, -32601);
    assert.deepEqual(calls.map((c) => c[0]), ['read_graph', 'run_graph']);
  });

  test('MCP over HTTP: loopback, the bearer token, POST only; OWUI gets it as a public tool-server env', async () => {
    const deps = { token: 'secret-token', version: '0', tools: () => MCP.TOOLS, call: async () => ({ text: 'ok' }) };
    const srv = await MCP.startMcpServer(deps, 0);
    const url = 'http://127.0.0.1:' + srv.address().port + '/mcp';
    const post = (h, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
    try {
      assert.equal(srv.address().address, '127.0.0.1', 'this machine only');
      assert.equal((await post({}, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
      assert.equal((await post({ authorization: 'Bearer nope-token!' }, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
      const r = await post({ authorization: 'Bearer secret-token' }, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      assert.equal(r.status, 200);
      assert.ok((await r.json()).result.tools.some((t) => t.name === 'add_box'));
      assert.equal((await post({ authorization: 'Bearer secret-token' }, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
      assert.equal((await fetch(url, { headers: { authorization: 'Bearer secret-token' } })).status, 405, 'no server-sent stream');
      // Critic N5: a request addressed to another name (DNS rebinding) is refused, even with the bearer.
      const http = require('http');
      const status = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: '/mcp', method: 'POST',
          headers: { host: `evil.example:${srv.address().port}`, authorization: 'Bearer secret-token', 'content-type': 'application/json' } },
        (res) => { res.resume(); resolve(res.statusCode); });
        req.on('error', reject);
        req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
      });
      assert.equal(status, 403);
    } finally { srv.close(); }
    const env = JSON.parse(CB.computerToolServer({ url: 'http://127.0.0.1:41995/mcp', token: 'secret-token' }));
    assert.deepEqual([env[0].type, env[0].auth_type, env[0].key, env[0].config.enable, env[0].info.id], ['mcp', 'bearer', 'secret-token', true, 'lol-computer']);
  });

  // -------------------------------------------- plugin keys tied to the farm password (2026-09-27)
  test('applyPluginKeys: a keyed farm\'s plugin keys come from the fetched answer, never from the beacon', () => {
    const keyed = { id: 'f', requiresKey: true, extract: { url: 'http://h:8888', key: null }, classify: { url: 'http://h:8891', key: null }, stt: null };
    // No password stored, or an open farm: nothing to do.
    assert.deepEqual(FS.applyPluginKeys(keyed, null, undefined, 0), { farm: keyed, fetchSig: null });
    const open = { ...keyed, requiresKey: false, extract: { url: 'http://h:8888', key: 'ek' } };
    assert.equal(FS.applyPluginKeys(open, 'pw', undefined, 0).fetchSig, null);
    // First time: fetch, and hand on the farm untouched meanwhile.
    const first = FS.applyPluginKeys(keyed, 'pw', undefined, 0);
    assert.ok(first.fetchSig && first.farm === keyed);
    // The answer is in: keys filled, no refetch.
    const hit = { sig: first.fetchSig, keys: { extract: 'ek', classify: 'ck', stt: null }, retryAt: 60_000 };
    const done = FS.applyPluginKeys(keyed, 'pw', hit, 1000);
    assert.equal(done.fetchSig, null);
    assert.deepEqual([done.farm.extract.key, done.farm.classify.key], ['ek', 'ck']);
    assert.equal(keyed.extract.key, null, 'the discovered farm is not mutated');
    // Another password (rotated, re-entered): fetch again.
    assert.ok(FS.applyPluginKeys(keyed, 'pw2', hit, 1000).fetchSig);
    // A failed fetch retries only after its retryAt.
    const failed = { sig: first.fetchSig, keys: {}, retryAt: 60_000 };
    assert.equal(FS.applyPluginKeys(keyed, 'pw', failed, 1000).fetchSig, null);
    assert.ok(FS.applyPluginKeys(keyed, 'pw', failed, 60_000).fetchSig);
    // Release critic R3: a plugin restart mints a new key; its new keyId is a new fetch.
    const restarted = { ...keyed, extract: { url: 'http://h:8888', key: null, keyId: 'aa11bb22' } };
    assert.ok(FS.applyPluginKeys(restarted, 'pw', hit, 1000).fetchSig, 'a changed keyId refetches');
    // Release critic R2: while that fetch is out, the loader OWUI already has for the same URL stays,
    // so a pending fetch never changes the launch env.
    const pending = FS.farmContext({ ...keyed, _host: 'h', proxyPort: 4000, models: [] }, 'pw');
    assert.equal(pending.extract, null);
    const known = { url: 'http://h:8888', key: 'ek' };
    assert.deepEqual(FS.keepPendingExtract(pending, keyed, known).extract, known);
    assert.equal(FS.keepPendingExtract(pending, keyed, { url: 'http://other:8888', key: 'x' }).extract, null, 'another address: not kept');
    assert.equal(FS.keepPendingExtract(pending, { ...keyed, requiresKey: false }, known).extract, null, 'an open farm: nothing pending');
    // The farm context then carries the fetched OCR key to OWUI.
    const ctx = FS.farmContext({ ...done.farm, _host: 'h', proxyPort: 4000, models: [] }, 'pw');
    assert.deepEqual(ctx.extract, { url: 'http://h:8888', key: 'ek' });
  });

  // ---------------------------------------------------------------- SA-5: the pin can be removed
  test('SA-5 chooseActive: a pin wins; with the pin cleared, least-busy selection applies again', () => {
    const busy = farm({ id: 'busy', n: 5, capacity: { slots: 1, clients: 1 } });   // 100 %
    const idle = farm({ id: 'idle', n: 6, capacity: { slots: 2, clients: 0 } });   //   0 %
    const farms = [busy, idle];
    const base = { selectedFarmId: null, activeFarmId: null, currentEndpoint: null, usable: () => true, rng: () => 0 };

    assert.equal(FS.chooseActive(farms, { ...base, selectedFarmId: 'busy' }).id, 'busy', 'the pin beats load');
    assert.equal(FS.chooseActive(farms, base).id, 'idle', 'no pin, nothing current: the least busy farm');
    assert.equal(FS.chooseActive(farms, { ...base, activeFarmId: 'busy' }).id, 'busy',
      'unpinning keeps a healthy current farm (sticky — no needless OWUI restart)');
    assert.equal(FS.chooseActive([{ ...busy, _stale: true }, idle], { ...base, selectedFarmId: 'busy', activeFarmId: 'busy' }).id, 'idle',
      'a pinned farm that stops answering fails over');
    assert.equal(FS.chooseActive([farm({ id: 'locked', requiresKey: true })], { ...base, usable: (f) => !f.requiresKey }), null,
      'a keyed farm without a password is never auto-picked');
  });

  test('SA-5 pickLeastLoaded: a coordinator absorbs the fleet; ties inside the band are scattered', () => {
    const a = farm({ id: 'a', n: 5, capacity: { slots: 4, clients: 0 } });
    const b = farm({ id: 'b', n: 6, capacity: { slots: 4, clients: 0 } });
    const coord = farm({ id: 'c', n: 7, capacity: { slots: 4, clients: 4 }, extra: { coordinator: true } });
    assert.equal(FS.pickLeastLoaded([a, b, coord], () => true, () => 0).id, 'c');
    assert.equal(FS.pickLeastLoaded([a, b], () => true, () => 0).id, 'a');
    assert.equal(FS.pickLeastLoaded([a, b], () => true, () => 0.99).id, 'b');
  });

  // ---------------------------------------------------------------- SA-4: the whole context, key included
  test('SA-4 farmContext: the password is part of what OWUI runs with, so a key change is a change', () => {
    const keyed = farm({
      id: 'k', requiresKey: true,
      extra: {
        searxngUrl: 'http://10.0.0.5:8081', ttsUrl: 'http://10.0.0.5:8880/v1', ttsVoice: null, ttsModel: null,
        extract: { url: 'http://10.0.0.5:8890', key: 'ocr' }, backend: { contextPerSlot: 16384 },
      },
    });
    const withKey = FS.farmContext(keyed, 'pw-new');
    assert.deepEqual(withKey, {
      endpoint: 'http://10.0.0.5:4000/v1', key: 'pw-new', model: 'gemma4:12b', searxng: 'http://10.0.0.5:8081',
      tts: { url: 'http://10.0.0.5:8880/v1', voice: 'af_heart', model: 'kokoro' },
      extract: { url: 'http://10.0.0.5:8890', key: 'ocr' }, ctxPerSlot: 16384,
    });
    assert.equal(FS.sameContext(withKey, FS.farmContext(keyed, 'pw-new')), true);
    assert.equal(FS.sameContext(withKey, FS.farmContext(keyed, 'pw-old')), false,
      'two farms (or two passwords) that differ only by the key used to look identical: OWUI 401-looped');
    assert.equal(FS.sameContext(withKey, null), false);
  });

  test('SA-4 persistedContext: the pin path persists EVERY cold-boot field, not just lastEndpoint', () => {
    const ctx = FS.farmContext(farm({ id: 'k', requiresKey: true, extra: { backend: { contextPerSlot: 32768 } } }), 'pw');
    const saved = FS.persistedContext(ctx);
    assert.deepEqual(Object.keys(saved).sort(), [
      'lastEndpoint', 'lastFarmCtxPerSlot', 'lastFarmExtract', 'lastFarmKey', 'lastFarmModel', 'lastFarmSearxng', 'lastFarmTts',
    ]);
    assert.equal(saved.lastFarmKey, 'pw');
    assert.equal(saved.lastFarmCtxPerSlot, 32768);
    // index.ts rebuilds "what OWUI runs with" from these on a cold boot; it must compare equal.
    const reboot = {
      endpoint: saved.lastEndpoint, key: saved.lastFarmKey, model: saved.lastFarmModel, searxng: saved.lastFarmSearxng,
      tts: saved.lastFarmTts, extract: saved.lastFarmExtract, ctxPerSlot: saved.lastFarmCtxPerSlot,
    };
    assert.equal(FS.sameContext(JSON.parse(JSON.stringify(reboot)), ctx), true, 'the first beacon after a relaunch is a no-op');
  });

  // 2026-10-07 (OWUI slow to load): the context was saved only when OWUI restarted, so a client that found its
  // farm during the boot never saved it — every launch waited for discovery, and one with the farm not seen yet
  // booted OWUI without it, then a second time when it came.
  test('connectPlan: a boot that found the farm saves it although OWUI already runs it; an unchanged beacon writes nothing', () => {
    const ctx = FS.farmContext(farm({
      id: 'f', extra: {
        searxngUrl: 'http://10.0.0.5:8888', ttsUrl: 'http://10.0.0.5:8880/v1',
        extract: { url: 'http://10.0.0.5:8890', key: 'ocr' }, backend: { contextPerSlot: 65536 },
      },
    }), null);
    const fresh = { autoScan: true, lastEndpoint: null, lastFarmModel: null };   // the store's defaults: nothing saved
    const first = FS.connectPlan(ctx, ctx, fresh);
    assert.equal(first.repoint, false, 'OWUI already runs this farm: no restart');
    assert.deepEqual(first.save, FS.persistedContext(ctx), 'but the next launch must boot with it');
    // The settings file as the store reads it back: the next beacon has nothing to do, so nothing is written.
    const settings = JSON.parse(JSON.stringify({ ...fresh, ...first.save }));
    assert.deepEqual(FS.connectPlan(ctx, ctx, settings), { repoint: false, save: null });
    // A cold boot runs the saved context; the farm's first beacon then changes nothing either.
    const booted = {
      endpoint: settings.lastEndpoint, key: settings.lastFarmKey, model: settings.lastFarmModel, searxng: settings.lastFarmSearxng,
      tts: settings.lastFarmTts, extract: settings.lastFarmExtract, ctxPerSlot: settings.lastFarmCtxPerSlot,
    };
    assert.deepEqual(FS.connectPlan(ctx, booted, settings), { repoint: false, save: null });
    // The farm serves another model: OWUI restarts and the settings follow.
    const plan = FS.connectPlan({ ...ctx, model: 'Qwen3.6' }, booted, settings);
    assert.equal(plan.repoint, true);
    assert.equal(plan.save && plan.save.lastFarmModel, 'Qwen3.6');
    // A boot with no farm at all (OWUI runs without one): restart, and save.
    assert.equal(FS.connectPlan(ctx, null, fresh).repoint, true);
  });

  // ---------------------------------------------------------------- SA-3: the host does not flip
  test('SA-3 Discovery: a farm seen as a beacon AND as an added hostname keeps one host', () => {
    const d = new Discovery({ autoScan: false, scanRange: { base: '10.0', third: [0, 0], fourth: [1, 1] } });
    const snap = { v: 1, id: 'studio', name: 'Studio', proxyPort: 4000, httpPort: 41997, healthy: true, models: [] };
    const hosts = [];
    for (let i = 0; i < 6; i++) {
      d.merge({ ...snap, ts: i }, i % 2 ? 'studio.local' : '10.0.0.5', i % 2 ? 'added' : 'beacon');
      hosts.push(d.getFarms()[0]._host);
    }
    assert.deepEqual([...new Set(hosts)], ['10.0.0.5'], `the endpoint host alternated: ${hosts.join(' → ')}`);
    assert.equal(d.getFarms()[0].ts, 5, 'the snapshot itself still refreshes on every sighting');

    // The first host goes quiet (no sighting under it for longer than STALE_MS): adopt the other one.
    d.peers.get('studio').hostSeen -= 60_000;
    d.merge({ ...snap, ts: 6 }, 'studio.local', 'added');
    assert.equal(d.getFarms()[0]._host, 'studio.local');
    assert.equal(d.getFarms()[0]._source, 'added', 'the source travels with the host it describes');
    d.merge({ ...snap, ts: 7 }, '10.0.0.5', 'beacon');
    assert.equal(d.getFarms()[0]._host, 'studio.local', 'and now THAT host is the sticky one');
  });

  // Recheck: a farm the beacon saw first keeps the beacon's record (SA-3), so an added entry that
  // reaches it never marked it 'added' — and prune() dropped it once it went quiet for DROP_MS.
  test('Discovery.prune keeps a farm the user added even when the beacon saw it first', () => {
    const d = new Discovery({ autoScan: false, manualPeers: ['studio.local'], scanRange: { base: '10.0', third: [0, 0], fourth: [1, 1] } });
    const snap = { v: 1, id: 'studio', name: 'Studio', proxyPort: 4000, httpPort: 41997, healthy: true, models: [] };
    d.merge({ ...snap }, '10.0.0.5', 'beacon');
    d.merge({ ...snap }, 'studio.local', 'added');
    assert.equal(d.getFarms()[0]._source, 'beacon', 'the record still describes the beacon host (SA-3)');
    d.peers.get('studio').lastSeen -= 10 * 60_000;       // silent for ten minutes
    d.prune();
    assert.equal(d.getFarms().length, 1, 'kept: the user added it');
    d.removeManualPeer('studio.local');
    d.prune();
    assert.equal(d.getFarms().length, 0, 'once the entry is removed, a silent farm is dropped as before');
  });

  // Multi-user 1.6: whether THIS client holds a seat comes only from a unicast /lol/self (the farm sees our IP there);
  // a beacon, which cannot know, must not erase it every 5 s between two 2 s active polls.
  test('Discovery: capacity.mine — a unicast answer always says it, a beacon keeps the last unicast word', async () => {
    const http = await import('node:http');
    const answers = [{ seatsUsed: 2, slots: 2, mine: true }, { seatsUsed: 2, slots: 2 }];
    const server = http.createServer((_req, res) => { res.end(JSON.stringify({ v: 1, id: 'studio', name: 'Studio', proxyPort: 4000, httpPort: 41997, healthy: true, models: [], capacity: answers.shift() })); });
    await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
    try {
      const port = /** @type {any} */ (server.address()).port;
      const d = new Discovery({ autoScan: false, scanRange: { base: '10.0', third: [0, 0], fourth: [1, 1] } });
      const ours = await d.fetchSelf('127.0.0.1', port, 1500);
      assert.equal(ours.capacity.mine, true);
      const older = await d.fetchSelf('127.0.0.1', port, 1500);
      assert.equal(older.capacity.mine, false, 'a farm that does not say (older, or not ours) is a definite no');
      const beacon = { v: 1, id: 'studio', name: 'Studio', proxyPort: 4000, httpPort: 41997, healthy: true, models: [] };
      d.merge(ours, '10.0.0.5', 'beacon');
      d.merge({ ...beacon, capacity: { seatsUsed: 2, slots: 2 } }, '10.0.0.5', 'beacon');
      assert.equal(d.getFarms()[0].capacity.mine, true, 'the beacon keeps the unicast answer');
      assert.equal(d.getFarms()[0].capacity.seatsUsed, 2, 'and still refreshes the counts');
      d.merge(older, '10.0.0.5', 'beacon');
      assert.equal(d.getFarms()[0].capacity.mine, false, 'the next unicast answer wins');
      d.merge({ ...beacon, capacity: { seatsUsed: 1, slots: 2 } }, '10.0.0.5', 'beacon');
      assert.equal(d.getFarms()[0].capacity.mine, false);
    } finally { server.close(); }
  });

  test('SA-5 Discovery.notify() re-sends the list (the popover re-marks the pin at once)', () => {
    const d = new Discovery({ autoScan: false, scanRange: { base: '10.0', third: [0, 0], fourth: [1, 1] } });
    let n = 0;
    d.on('farms', () => { n++; });
    d.notify();
    assert.equal(n, 1);
  });

  // ---------------------------------------------------------------- SA-2: HF_HUB_OFFLINE really turns on
  test('SA-2 hfModelsCached: MiniLM in the HF hub, Whisper under DATA_DIR/cache/whisper/models', () => {
    const home = tempDir('home');
    const data = tempDir('data');
    const env = {};
    const hub = path.join(home, '.cache', 'huggingface', 'hub');
    assert.equal(CB.hfHubDir(env, home), hub);
    assert.equal(CB.hfModelsCached(data, env, home), false, 'nothing cached');

    seedHf(hub, MINILM);
    assert.equal(CB.hfModelsCached(data, env, home), false, 'MiniLM alone is not enough');
    seedHf(hub, WHISPER);
    assert.equal(CB.hfModelsCached(data, env, home), false,
      'Whisper in the HUB is where the old check looked — OWUI 0.10.2 never puts it there');
    seedHf(path.join(data, 'cache', 'whisper', 'models'), WHISPER);
    assert.equal(CB.hfModelsCached(data, env, home), true, 'both where OWUI actually loads them from');
    assert.equal(CB.hfModelsCached(tempDir('fresh'), env, home), false,
      'a "Start fresh" data folder stays online until Whisper is fetched into it');

    // The cache location follows huggingface_hub's own resolution order.
    const other = tempDir('hfhome');
    assert.equal(CB.hfHubDir({ HF_HOME: other }, home), path.join(other, 'hub'));
    assert.equal(CB.hfHubDir({ HF_HOME: other, HF_HUB_CACHE: '/x/hub' }, home), '/x/hub');
    assert.equal(CB.hfModelsCached(data, { HF_HOME: other }, home), false, 'MiniLM is not in THAT hub');
    seedHf(path.join(other, 'hub'), MINILM);
    assert.equal(CB.hfModelsCached(data, { HF_HOME: other }, home), true);
  });

  test('SA-2 buildSidecarEnv: HF_HUB_OFFLINE=1 once both models are cached, else the etag timeout', async () => {
    const hfHome = tempDir('hfenv');
    const data = tempDir('dataenv');
    await withEnv({ HF_HOME: hfHome, HF_HUB_CACHE: undefined, SENTENCE_TRANSFORMERS_HOME: undefined, WHISPER_MODEL_DIR: undefined }, () => {
      const before = CB.buildSidecarEnv({ endpoint: null, dataDir: data });
      assert.equal(before.HF_HUB_OFFLINE, undefined);
      assert.equal(before.HF_HUB_ETAG_TIMEOUT, '2');
      seedHf(path.join(hfHome, 'hub'), MINILM);
      seedHf(path.join(data, 'cache', 'whisper', 'models'), WHISPER);
      const after = CB.buildSidecarEnv({ endpoint: null, dataDir: data });
      assert.equal(after.HF_HUB_OFFLINE, '1');
      assert.equal(after.HF_HUB_ETAG_TIMEOUT, undefined);
      assert.equal(after.DATA_DIR, data);
    });
  });

  // 2026-10-07: until Whisper was cached (first use of OWUI's mic) every boot asked huggingface.co for MiniLM's latest
  // revision with no timeout — 21 s per boot where that site is silently blocked; the etag timeout never covered it.
  test('buildSidecarEnv: OWUI never asks huggingface.co for a newer MiniLM at boot, cached or not', async () => {
    const data = tempDir('noupdate');
    await withEnv({ HF_HOME: tempDir('hfempty'), HF_HUB_CACHE: undefined, SENTENCE_TRANSFORMERS_HOME: undefined, WHISPER_MODEL_DIR: undefined }, () => {
      const env = CB.buildSidecarEnv({ endpoint: 'http://10.0.0.5:4000/v1', dataDir: data });
      assert.equal(env.HF_HUB_OFFLINE, undefined, 'nothing cached: the hub stays reachable for the first downloads');
      assert.equal(env.RAG_EMBEDDING_MODEL_AUTO_UPDATE, 'false');
    });
  });

  test('decision 9 buildSidecarEnv: OWUI\'s background tasks answer without thinking; chats are untouched', () => {
    const env = CB.buildSidecarEnv({ endpoint: 'http://10.0.0.5:4000/v1', dataDir: tempDir('tasks') });
    // OWUI 0.11.4 copies these onto the title and web-search-query requests (routers/tasks.py
    // apply_task_model_params); a set value replaces the title's own max_tokens 1000, hence restated.
    assert.deepEqual(JSON.parse(env.TASK_MODEL_PARAMS), { chat_template_kwargs: { enable_thinking: false }, think: false, max_tokens: 1000 });
    assert.equal(env.DEFAULT_MODEL_PARAMS, undefined, 'a chat keeps thinking');
  });

  // ---------------------------------------------------------------- SA-1: a crash restart keeps every field
  test('SA-1 SidecarSupervisor: a crash restart and a data-folder move relaunch with EVERY field', async () => {
    const opts = {
      endpoint: 'http://10.0.0.5:4000/v1', dataDir: tempDir('sa1'), apiKey: 'pw', defaultModel: 'gemma4:12b',
      searxngUrl: 'http://10.0.0.5:8081', tts: { url: 'http://10.0.0.5:8880/v1', voice: 'af_heart', model: 'kokoro' },
      extract: { url: 'http://10.0.0.5:8890', key: 'ocr' }, contextPerSlot: 16384,
    };
    const sup = new SidecarSupervisor();
    sup.on('state', () => {});
    // A sidecar command that does not exist: start() stores its inputs, reports the error, spawns nothing.
    await withEnv({ LOL_SIDECAR_CMD: path.join(tempDir('nocmd'), 'missing', 'open-webui') }, () => sup.start(opts));
    assert.equal(sup.getState().status, 'error');

    const calls = [];
    sup.start = async (/** @type {any} */ o) => { calls.push(o); };
    const child = /** @type {any} */ ({ pid: undefined });
    sup.child = child;
    sup.onChildExit(child, 1);
    assert.deepEqual(calls[0], opts, 'the crash restart dropped a field (contextPerSlot → RAG_FULL_CONTEXT=true on a 16k farm)');

    const moved = tempDir('sa1-moved');
    await sup.setDataDir(moved);
    assert.deepEqual(calls[1], { ...opts, dataDir: moved });
  });

  // ---------------------------------------------------------------- SA-6: a staged update never leaves no engine
  const live = path.join(USER_DATA, 'sidecar');
  const pending = live + '.pending';
  const resetTrees = () => { for (const d of [live, pending, live + '.old']) fs.rmSync(d, { recursive: true, force: true }); };
  const tree = (/** @type {string} */ dir, /** @type {string} */ tag) => {
    fs.mkdirSync(path.join(dir, 'python'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'OPENWEBUI_VERSION'), tag);
  };
  const version = (/** @type {string} */ dir) => fs.readFileSync(path.join(dir, 'OPENWEBUI_VERSION'), 'utf8');

  test('SA-6 applyPendingSidecar: swaps the staged tree in and cleans up', () => {
    resetTrees();
    tree(live, '0.10.1');
    tree(pending, '0.10.2');
    assert.equal(SM.applyPendingSidecar(), true);
    assert.equal(version(live), '0.10.2');
    assert.equal(fs.existsSync(pending), false);
    assert.equal(fs.existsSync(live + '.old'), false);
    assert.equal(SM.applyPendingSidecar(), false, 'nothing staged: nothing to do');
  });

  test('SA-6 applyPendingSidecar: a swap that died between its renames is repaired at the next boot', () => {
    resetTrees();
    tree(live + '.old', '0.10.1');
    assert.equal(SM.applyPendingSidecar(), false);
    assert.equal(version(live), '0.10.1', 'the engine came back from live.old');
  });

  const held = process.platform === 'win32' ? test : test.skip;
  held('SA-6 applyPendingSidecar (Windows): a file held open under sidecar.pending keeps the live engine', () => {
    resetTrees();
    tree(live, '0.10.1');
    tree(pending, '0.10.2');
    fs.writeFileSync(path.join(pending, 'python', 'python.exe'), 'x');
    const fd = fs.openSync(path.join(pending, 'python', 'python.exe'), 'r');   // a compileall still running
    try {
      assert.equal(SM.applyPendingSidecar(), false);
      assert.equal(version(live), '0.10.1', 'the old code deleted this first and left NO sidecar');
      assert.equal(version(pending), '0.10.2', 'the update is kept for the next launch');
    } finally { fs.closeSync(fd); }
    assert.equal(SM.applyPendingSidecar(), true, 'and lands on the next launch');
    assert.equal(version(live), '0.10.2');
  });

  // ---------------------------------------------------------------- B-3: a dev build never checks GitHub
  test('B-3 checkOwuiUpdate/downloadOwuiUpdate: a dev build answers at once and stages nothing', async () => {
    resetTrees();
    fakeApp.isPackaged = false;
    const r = await SM.checkOwuiUpdate();
    assert.equal(r.latest, null);
    assert.equal(r.updateAvailable, false);
    assert.match(r.error, /installed build/);
    const d = await SM.downloadOwuiUpdate();
    assert.equal(d.ok, false);
    assert.equal(fs.existsSync(pending), false, 'no ~700 MB sidecar.pending in a dev tree');
  });

  // ---------------------------------------------------------------- the client's data in DATA_DIR
  // Owner rule 2026-09-27: LOL Chat's history and the Computer's graphs live in the data folder, as
  // the main window's session at <DATA_DIR>/lol-client (clientData.ts, run by index.ts before app
  // 'ready'). Fixtures are the Chromium layout measured on Electron 42.
  const write = (/** @type {string} */ f, /** @type {string} */ text) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  /** Every file under dir → its text, keyed by the path relative to dir (forward slashes). */
  const snapshot = (/** @type {string} */ dir) => {
    /** @type {Record<string, string>} */ const out = {};
    const walk = (/** @type {string} */ d) => {
      let ents = [];
      try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p); else out[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p, 'utf8');
      }
    };
    walk(dir);
    return out;
  };
  /** A v0.1.45 userData: the default session's storage, plus things that are NOT the client's. */
  const legacyProfile = (/** @type {string} */ ud) => {
    write(path.join(ud, 'IndexedDB', 'file__0.indexeddb.leveldb', 'CURRENT'), 'MANIFEST-000001\n');
    write(path.join(ud, 'IndexedDB', 'file__0.indexeddb.leveldb', '000003.log'), 'threads: Rig notes');
    write(path.join(ud, 'IndexedDB', 'file__0.indexeddb.leveldb', 'LOCK'), '');
    write(path.join(ud, 'IndexedDB', 'file__0.indexeddb.blob', '1', '00', '1'), '%PDF a graph attachment');
    write(path.join(ud, 'Local Storage', 'leveldb', '000003.log'), 'lol:view=computer lol.chat.threads.v1=[...]');
    write(path.join(ud, 'Local Storage', 'leveldb', 'LOCK'), '');
    write(path.join(ud, 'WebStorage', 'QuotaManager'), 'sqlite');
    write(path.join(ud, 'Partitions', 'owui', 'Local Storage', 'leveldb', '000003.log'), 'owui token');
    write(path.join(ud, 'Cache', 'Cache_Data', 'index'), 'cache');
    write(path.join(ud, 'shell-settings.json'), '{}');
  };
  /** A client session folder as Chromium leaves it. */
  const sessionFolder = (/** @type {string} */ dir, /** @type {string} */ tag) => {
    write(path.join(dir, 'IndexedDB', 'file__0.indexeddb.leveldb', '000003.log'), `threads: ${tag}`);
    write(path.join(dir, 'IndexedDB', 'file__0.indexeddb.leveldb', 'LOCK'), '');
    write(path.join(dir, 'Local Storage', 'leveldb', '000003.log'), `prefs: ${tag}`);
    write(path.join(dir, 'WebStorage', 'QuotaManager'), `quota: ${tag}`);
  };
  const CLIENT_FILES = [
    'IndexedDB/file__0.indexeddb.blob/1/00/1', 'IndexedDB/file__0.indexeddb.leveldb/000003.log',
    'IndexedDB/file__0.indexeddb.leveldb/CURRENT', 'Local Storage/leveldb/000003.log', 'WebStorage/QuotaManager',
  ];

  test('clientDataDir: the client session lives in <DATA_DIR>/lol-client', () => {
    const data = path.join(tempDir('cdd'), 'My LlmOnLan data');
    assert.equal(CD.CLIENT_DIR_NAME, 'lol-client');
    assert.equal(CD.clientDataDir(data), path.join(data, 'lol-client'));
    assert.deepEqual([...CD.LEGACY_ITEMS], ['IndexedDB', 'Local Storage', 'WebStorage']);
    assert.equal(CD.hasClientData(path.join(data, 'lol-client')), false);
    write(path.join(data, 'lol-client', 'Local Storage', 'leveldb', 'CURRENT'), 'x');
    assert.equal(CD.hasClientData(path.join(data, 'lol-client')), true, 'a folder a session opened once has Local Storage');
  });

  test('migrateLegacy: copies the three folders into an empty target, skips LOCK, leaves the rest behind', () => {
    const ud = tempDir('legacy-ud');
    legacyProfile(ud);
    const before = snapshot(ud);
    const target = CD.clientDataDir(path.join(ud, 'owui-data'));
    const r = CD.migrateLegacy(ud, target);
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.copied, ['IndexedDB', 'Local Storage', 'WebStorage']);
    assert.deepEqual(Object.keys(snapshot(target)).sort(), CLIENT_FILES,
      'exactly the client storage, blobs included — no LOCK, no Cache, no Partitions/owui, no settings');
    assert.equal(snapshot(target)['IndexedDB/file__0.indexeddb.blob/1/00/1'], '%PDF a graph attachment');
    const after = snapshot(ud);
    for (const [k, v] of Object.entries(before)) assert.equal(after[k], v, `the source lost or changed ${k} — it is the backup`);
  });

  test('migrateLegacy: never overwrites a target that already has a history, never deletes the source', () => {
    const ud = tempDir('legacy-ud2');
    legacyProfile(ud);
    const target = path.join(tempDir('legacy-t2'), 'lol-client');
    write(path.join(target, 'Local Storage', 'leveldb', '000003.log'), 'the NEWER history');
    const r = CD.migrateLegacy(ud, target);
    assert.deepEqual(r, { ok: true, copied: [], skipped: 'target-has-data' });
    assert.deepEqual(snapshot(target), { 'Local Storage/leveldb/000003.log': 'the NEWER history' });
    assert.equal(fs.existsSync(path.join(ud, 'IndexedDB', 'file__0.indexeddb.leveldb', '000003.log')), true);

    const emptyUd = tempDir('legacy-none');
    write(path.join(emptyUd, 'shell-settings.json'), '{}');
    const fresh = path.join(tempDir('legacy-t3'), 'lol-client');
    assert.deepEqual(CD.migrateLegacy(emptyUd, fresh), { ok: true, copied: [], skipped: 'no-legacy-data' });
    assert.equal(fs.existsSync(fresh), false, 'a fresh install creates nothing');
  });

  test('migrateLegacy: a copy that fails half-way is removed again (the next launch retries), source intact', () => {
    const ud = tempDir('legacy-fail');
    legacyProfile(ud);
    const before = snapshot(ud);
    const target = path.join(tempDir('legacy-fail-t'), 'lol-client');
    write(path.join(target, 'WebStorage'), 'a FILE where the folder goes');     // copying the folder onto it fails
    const r = CD.migrateLegacy(ud, target);
    assert.equal(r.ok, false);
    assert.ok(r.error);
    assert.equal(CD.hasClientData(target), false, 'the half copy of IndexedDB / Local Storage is gone');
    assert.equal(fs.readFileSync(path.join(target, 'WebStorage'), 'utf8'), 'a FILE where the folder goes', 'what was there is kept');
    assert.deepEqual(snapshot(ud), before);
  });

  test('movePendingClientData: copies, then removes the source; no staging folder left', () => {
    const root = tempDir('move');
    const from = path.join(root, 'old', 'lol-client');
    const to = path.join(root, 'new data', 'lol-client');
    sessionFolder(from, 'mine');
    const r = CD.movePendingClientData(from, to);
    assert.deepEqual(r, { ok: true, moved: true, replacedTo: undefined });
    assert.deepEqual(snapshot(to), {
      'IndexedDB/file__0.indexeddb.leveldb/000003.log': 'threads: mine',
      'Local Storage/leveldb/000003.log': 'prefs: mine',
      'WebStorage/QuotaManager': 'quota: mine',
    });
    assert.equal(fs.existsSync(from), false, 'the source is removed once the copy is in place');
    assert.equal(fs.existsSync(`${to}.moving`), false);
    assert.deepEqual(CD.movePendingClientData(from, to), { ok: true, moved: false }, 'nothing left to move: a no-op');
  });

  test('movePendingClientData: refuses nested paths and leaves the source intact on failure', () => {
    const root = tempDir('move-bad');
    const from = path.join(root, 'data', 'lol-client');
    sessionFolder(from, 'keep me');
    const before = snapshot(from);
    const inside = CD.movePendingClientData(from, path.join(from, 'sub', 'lol-client'));
    assert.equal(inside.ok, false);
    assert.match(inside.error, /inside/);
    const outside = CD.movePendingClientData(from, path.dirname(from));
    assert.equal(outside.ok, false);
    assert.match(outside.error, /inside/);

    write(path.join(root, 'not-a-folder'), 'a file');                  // mkdir of the target's parent fails
    const failed = CD.movePendingClientData(from, path.join(root, 'not-a-folder', 'lol-client'));
    assert.equal(failed.ok, false);
    assert.ok(failed.error);
    assert.deepEqual(snapshot(from), before, 'the source is untouched after every refusal and failure');
  });

  test('movePendingClientData: a history already at the target is set aside, never deleted', () => {
    const root = tempDir('move-replace');
    const from = path.join(root, 'old', 'lol-client');
    const to = path.join(root, 'new', 'lol-client');
    sessionFolder(from, 'moving');
    sessionFolder(to, 'was here');
    const r = CD.movePendingClientData(from, to, new Date('2026-09-27T10:00:00Z'));
    assert.equal(r.ok, true);
    assert.equal(r.replacedTo, `${path.resolve(to)}.replaced-2026-09-27T10-00-00-000Z`);
    assert.equal(snapshot(to)['Local Storage/leveldb/000003.log'], 'prefs: moving');
    assert.equal(snapshot(r.replacedTo)['Local Storage/leveldb/000003.log'], 'prefs: was here');
  });

  test('moveDataDir {exclude}: OWUI data moves, lol-client stays for the next boot', () => {
    const root = tempDir('owui-move');
    const src = path.join(root, 'old');
    const dest = path.join(root, 'new');
    write(path.join(src, 'webui.db'), 'db');
    write(path.join(src, 'uploads', 'a.pdf'), 'pdf');
    write(path.join(src, 'LOL Studio Projects', 'p1', 'out.txt'), 'file box');
    sessionFolder(path.join(src, 'lol-client'), 'held open');
    const r = DM.moveDataDir(src, dest, { exclude: ['lol-client'] });
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(Object.keys(snapshot(dest)).sort(), ['LOL Studio Projects/p1/out.txt', 'uploads/a.pdf', 'webui.db']);
    assert.deepEqual(fs.readdirSync(src), ['lol-client'], 'only the client session is left, for the boot move');
    assert.equal(DM.moveDataDir(path.join(root, 'x'), path.join(root, 'x', 'y'), { exclude: ['lol-client'] }).ok, true,
      'a missing source is still "nothing to copy"');
  });

  test('prepareClientData + store: a Preferences move lands at the next boot and the marker is cleared', () => {
    const ud = tempDir('boot-ud');
    const oldData = path.join(tempDir('boot-old'), 'data');
    const newData = path.join(tempDir('boot-new'), 'data');
    sessionFolder(CD.clientDataDir(oldData), 'moved by prefs');
    // What set-data-dir saves before the relaunch — through the real store, onto disk.
    STORE.updateSettings({
      dataDir: newData, legacyClientDataImported: true,
      pendingClientMove: { from: CD.clientDataDir(oldData), to: CD.clientDataDir(newData) },
    });
    const onDisk = () => JSON.parse(fs.readFileSync(path.join(USER_DATA, 'shell-settings.json'), 'utf8'));
    assert.deepEqual(onDisk().pendingClientMove, { from: CD.clientDataDir(oldData), to: CD.clientDataDir(newData) },
      'the marker is in shell-settings.json, so it survives the relaunch');

    const s = STORE.loadSettings();
    const plan = CD.prepareClientData({
      userDataDir: ud, dataDir: s.dataDir, settings: s, save: (/** @type {any} */ p) => { STORE.updateSettings(p); },
    });
    assert.equal(plan.dir, CD.clientDataDir(newData));
    assert.equal(snapshot(CD.clientDataDir(newData))['Local Storage/leveldb/000003.log'], 'prefs: moved by prefs');
    assert.equal(fs.existsSync(oldData), false, 'the old data folder, empty once lol-client left it, is removed');
    assert.equal(STORE.loadSettings().pendingClientMove, null);
    assert.equal(onDisk().pendingClientMove, null, 'the marker is cleared ON DISK: the next launch does not move again');
    assert.equal(plan.notices.length, 1);
    assert.equal(plan.notices[0].level, 'info');
    assert.match(plan.notices[0].text, /now lives in/);
  });

  test('prepareClientData: a move that fails keeps the marker and runs on the untouched source', () => {
    const ud = tempDir('boot-fail-ud');
    const root = tempDir('boot-fail');
    const from = CD.clientDataDir(path.join(root, 'old'));
    sessionFolder(from, 'still here');
    write(path.join(root, 'blocked'), 'a file where the new data folder goes');
    const to = CD.clientDataDir(path.join(root, 'blocked'));
    /** @type {Record<string, any>} */ let saved = {};
    const plan = CD.prepareClientData({
      userDataDir: ud, dataDir: path.join(root, 'blocked'),
      settings: { pendingClientMove: { from, to }, legacyClientDataImported: true },
      save: (/** @type {any} */ p) => { saved = { ...saved, ...p }; }, attempts: 2, sleep: () => {},
    });
    assert.equal(plan.dir, from, 'the window opens on the data it had');
    assert.deepEqual(saved, {}, 'the marker stays: the next launch tries again');
    assert.equal(snapshot(from)['Local Storage/leveldb/000003.log'], 'prefs: still here');
    assert.equal(plan.notices[0].level, 'warn');
    assert.equal(plan.log.filter((/** @type {string} */ l) => /attempt \d failed/.test(l)).length, 2, 'retried');
  });

  test('prepareClientData: the v0.1.x import runs once — a later "Start fresh" folder stays empty', () => {
    const ud = tempDir('boot-legacy-ud');
    legacyProfile(ud);
    const first = path.join(tempDir('boot-legacy-a'), 'data');
    /** @type {any} */ let settings = { pendingClientMove: null, legacyClientDataImported: false };
    const save = (/** @type {any} */ p) => { settings = { ...settings, ...p }; };
    const plan = CD.prepareClientData({ userDataDir: ud, dataDir: first, settings, save });
    assert.equal(plan.dir, CD.clientDataDir(first));
    assert.deepEqual(Object.keys(snapshot(plan.dir)).sort(), CLIENT_FILES);
    assert.equal(settings.legacyClientDataImported, true);
    assert.equal(plan.notices[0].level, 'info');

    const fresh = path.join(tempDir('boot-legacy-b'), 'data');
    const again = CD.prepareClientData({ userDataDir: ud, dataDir: fresh, settings, save });
    assert.equal(again.dir, CD.clientDataDir(fresh));
    assert.equal(CD.hasClientData(again.dir), false, 'the old v0.1.x copy is not poured into a fresh folder');
    assert.deepEqual(again.notices, []);
  });

  test('prepareClientData: an older build writing the old IndexedDB after the import is warned about, once per change', () => {
    const ud = tempDir('boot-stamp-ud');
    legacyProfile(ud);
    const data = path.join(tempDir('boot-stamp'), 'data');
    /** @type {any} */ let settings = { pendingClientMove: null, legacyClientDataImported: false, legacyClientDataStamp: null };
    const save = (/** @type {any} */ p) => { settings = { ...settings, ...p }; };
    const boot = () => CD.prepareClientData({ userDataDir: ud, dataDir: data, settings, save });
    boot();
    assert.equal(settings.legacyClientDataStamp, CD.legacyStamp(ud), 'the old copy is fingerprinted at the import');
    assert.ok(settings.legacyClientDataStamp);
    assert.deepEqual(boot().notices, [], 'unchanged: nothing to say');

    // A dev build from before this change (default session, sharing this userData) saved a chat there.
    write(path.join(ud, 'IndexedDB', 'file__0.indexeddb.leveldb', '000005.log'), 'a chat written after the import');
    const warned = boot();
    assert.equal(warned.notices.length, 1);
    assert.equal(warned.notices[0].level, 'warn');
    assert.match(warned.notices[0].text, /not merged/);
    assert.ok(warned.notices[0].text.includes(path.join(ud, 'IndexedDB')), 'it says where that history is');
    assert.equal(snapshot(CD.clientDataDir(data))['IndexedDB/file__0.indexeddb.leveldb/000005.log'], undefined, 'and merges nothing');
    assert.deepEqual(boot().notices, [], 'once per change, not at every launch');

    // A data folder that already had a history when the import first ran: said, not merged.
    const ud2 = tempDir('boot-stamp-ud2');
    legacyProfile(ud2);
    const data2 = path.join(tempDir('boot-stamp2'), 'data');
    sessionFolder(CD.clientDataDir(data2), 'dev build');
    /** @type {any} */ let s2 = { pendingClientMove: null, legacyClientDataImported: false };
    const first = CD.prepareClientData({ userDataDir: ud2, dataDir: data2, settings: s2, save: (/** @type {any} */ p) => { s2 = { ...s2, ...p }; } });
    assert.equal(first.notices[0].level, 'warn');
    assert.match(first.notices[0].text, /already had a LOL Chat history/);
    assert.equal(snapshot(CD.clientDataDir(data2))['Local Storage/leveldb/000003.log'], 'prefs: dev build', 'nothing overwritten');
  });

  test('prepareClientData: an unwritable DATA_DIR falls back to <userData>/lol-client, says so, and comes back later', () => {
    const ud = tempDir('boot-fb-ud');
    const root = tempDir('boot-fb');
    write(path.join(root, 'drive'), 'a file: the "drive" is not there');
    const away = path.join(root, 'drive', 'data');
    /** @type {any} */ let settings = { pendingClientMove: null, legacyClientDataImported: true };
    const save = (/** @type {any} */ p) => { settings = { ...settings, ...p }; };
    const plan = CD.prepareClientData({ userDataDir: ud, dataDir: away, settings, save });
    assert.equal(plan.dir, path.join(ud, 'lol-client'));
    assert.equal(plan.notices[0].level, 'warn');
    assert.match(plan.notices[0].text, /cannot be written/);

    // That session kept a history in the fallback; the data folder comes back empty → it moves in.
    sessionFolder(path.join(ud, 'lol-client'), 'written while away');
    const back = path.join(root, 'back', 'data');
    const plan2 = CD.prepareClientData({ userDataDir: ud, dataDir: back, settings, save });
    assert.equal(plan2.dir, CD.clientDataDir(back));
    assert.equal(snapshot(plan2.dir)['Local Storage/leveldb/000003.log'], 'prefs: written while away');
    assert.equal(fs.existsSync(path.join(ud, 'lol-client')), false);
  });

  // ---------------------------------------------------------------- io.ts: the Fetch box's GET (ecosystem plan v2 §4.2)
  test('io.checkUrl / blockedAddress: http(s) only, no credentials, never this machine, link-local or a farm port', () => {
    const IO = require(path.join(BUILD, 'io.js'));
    const code = (u, allow) => { const r = IO.checkUrl(u, allow); return r.ok ? 'ok' : r.code; };
    assert.equal(code('https://hn.algolia.com/api/v1/search?tags=front_page'), 'ok');
    assert.equal(code('http://192.168.1.40/data.json'), 'ok', 'a LAN device (an ESP32) is allowed');
    assert.equal(code('file:///C:/secret.txt'), 'E_SCHEME');
    assert.equal(code('ftp://example.org/x'), 'E_SCHEME');
    assert.equal(code('not a url'), 'E_URL');
    assert.equal(code('https://user:pw@example.org/'), 'E_CREDENTIALS');
    assert.equal(code('http://localhost:9000/'), 'E_LOCAL');
    assert.equal(code('http://127.0.0.5/'), 'E_LOCAL');
    assert.equal(code('http://[::1]:8000/'), 'E_LOCAL');
    assert.equal(code('http://169.254.169.254/latest/meta-data'), 'E_LOCAL', 'link-local (cloud metadata style) is refused');
    assert.equal(code('http://10.10.16.58:4000/v1/models'), 'E_FARM', 'the farm proxy port');
    assert.equal(code('http://10.10.16.58:41997/lol/admin'), 'E_FARM', 'the admin panel port');
    assert.equal(code('http://127.0.0.1:5555/', true), 'ok', 'the harness may reach its own fixtures');
    assert.equal(IO.blockedAddress('::ffff:127.0.0.1'), true, 'an IPv4-mapped loopback');
    // Critic P1P2 M1: `new URL` rewrites a mapped address to HEX, which a dotted-quad regex missed.
    assert.equal(new URL('http://[::ffff:127.0.0.1]:9/').hostname, '[::ffff:7f00:1]', 'what the URL parser really hands us');
    assert.equal(code('http://[::ffff:127.0.0.1]:5555/'), 'E_LOCAL', 'mapped loopback, hex form');
    assert.equal(code('http://[::ffff:169.254.169.254]/'), 'E_LOCAL', 'mapped link-local');
    assert.equal(code('http://[::ffff:0.0.0.0]:80/'), 'E_LOCAL', 'mapped any');
    assert.equal(code('http://[::127.0.0.1]:80/'), 'E_LOCAL', 'IPv4-compatible form');
    assert.equal(code('http://[64:ff9b::7f00:1]/'), 'E_LOCAL', 'NAT64 form');
    assert.equal(code('http://2130706433/'), 'E_LOCAL', 'a decimal IPv4 (the URL parser makes it 127.0.0.1)');
    assert.equal(code('http://[::ffff:8.8.8.8]/'), 'ok', 'a mapped PUBLIC address stays reachable');
    assert.equal(code('http://example.org:8892/'), 'E_FARM', 'the speech-to-text port is a farm port too');
    const own = Object.values(os.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal);
    if (own) assert.equal(IO.blockedAddress(own.address), true, `this machine's own LAN address (${own.address})`);
    assert.equal(IO.blockedAddress('fe80::1'), true);
    assert.equal(IO.blockedAddress('8.8.8.8'), false);
    assert.equal(IO.isTextType('application/json; charset=utf-8'), true);
    assert.equal(IO.isTextType('image/png'), false);
  });

  test('io.fetchText: DNS that answers loopback is refused; a redirect is re-checked; the cap holds; errors never throw', async () => {
    const IO = require(path.join(BUILD, 'io.js'));
    const ok = (body, headers = {}) => new Response(body, { status: 200, headers: { 'content-type': 'application/json', ...headers } });
    const pub = async () => [{ address: '93.184.216.34' }];
    // DNS rebinding-lite: a public name that resolves to this machine.
    let r = await IO.fetchText('https://evil.example/', { lookup: async () => [{ address: '127.0.0.1' }], fetchImpl: async () => ok('{}') });
    assert.deepEqual([r.ok, r.code], [false, 'E_LOCAL']);
    // A redirect to a blocked address is refused on the second hop.
    const redirect = new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/x' } });
    r = await IO.fetchText('https://a.example/', { lookup: pub, fetchImpl: async () => redirect });
    assert.deepEqual([r.ok, r.code], [false, 'E_LOCAL']);
    // A good answer, followed through one relative redirect.
    let calls = 0;
    r = await IO.fetchText('https://a.example/start', { lookup: pub, fetchImpl: async (u) => (++calls === 1
      ? new Response(null, { status: 301, headers: { location: '/data' } }) : ok('{"hits":[1,2]}')) });
    assert.equal(r.ok, true);
    assert.equal(r.url, 'https://a.example/data');
    assert.equal(r.text, '{"hits":[1,2]}');
    // Over the cap, streamed (no content-length): cut, E_SIZE.
    const big = 'x'.repeat(IO.FETCH_MAX_BYTES + 10);
    r = await IO.fetchText('https://a.example/big', { lookup: pub, fetchImpl: async () => ok(big, { 'content-type': 'text/plain' }) });
    assert.deepEqual([r.ok, r.code], [false, 'E_SIZE']);
    // Not text, an HTTP error, a thrown fetch: answers, never throws.
    r = await IO.fetchText('https://a.example/p.png', { lookup: pub, fetchImpl: async () => ok('x', { 'content-type': 'image/png' }) });
    assert.equal(r.code, 'E_TYPE');
    r = await IO.fetchText('https://a.example/404', { lookup: pub, fetchImpl: async () => new Response('no', { status: 404 }) });
    assert.deepEqual([r.code, r.status], ['E_HTTP', 404]);
    // What the site said about its refusal rides along, briefly (the rig: an agent retried blind on a bare 400).
    r = await IO.fetchText('https://a.example/q', { lookup: pub, fetchImpl: async () => new Response('{"errors": [{"detail":\n "Page size exceeds allowed maximum: 200"}]}', { status: 400, headers: { 'content-type': 'application/json' } }) });
    assert.deepEqual([r.code, r.status, r.detail], ['E_HTTP', 400, '{"errors": [{"detail": "Page size exceeds allowed maximum: 200"}]}']);
    r = await IO.fetchText('https://a.example/q', { lookup: pub, fetchImpl: async () => new Response('x'.repeat(5000), { status: 500, headers: { 'content-type': 'text/plain' } }) });
    assert.equal(r.detail.length, 301, 'at most 300 characters and an ellipsis');
    r = await IO.fetchText('https://a.example/q', { lookup: pub, fetchImpl: async () => new Response('binary', { status: 500, headers: { 'content-type': 'image/png' } }) });
    assert.equal(r.detail, undefined, 'not text: nothing quoted');
    r = await IO.fetchText('https://a.example/', { lookup: pub, fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    assert.equal(r.code, 'E_NET');
    r = await IO.fetchText('https://nowhere.invalid/', { lookup: async () => { throw new Error('ENOTFOUND'); } });
    assert.equal(r.code, 'E_DNS');
    // Critic P1P2 S4: a Location the URL parser refuses is an answer, not a throw.
    r = await IO.fetchText('https://a.example/', { lookup: pub, fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'http://exa mple.com/' } }) });
    assert.equal(r.code, 'E_URL');
  });

  test('io.fetchText with allowed hosts (critic S3): every hop, a redirect included, is checked BEFORE any request', async () => {
    const IO = require(path.join(BUILD, 'io.js'));
    const pub = async () => [{ address: '93.184.216.34' }];
    /** @type {string[]} */ const asked = [];
    const hosts = ['tabular-api.data.gouv.fr'];
    // An open redirect on an allowed host must not carry the request to another one.
    let r = await IO.fetchText('https://tabular-api.data.gouv.fr/go', { lookup: pub, hosts, fetchImpl: async (u) => {
      asked.push(String(u));
      return new Response(null, { status: 302, headers: { location: 'https://evil.example/?data=secret' } });
    } });
    assert.deepEqual([r.ok, r.code, r.message], [false, 'E_HOST', 'evil.example']);
    assert.deepEqual(asked, ['https://tabular-api.data.gouv.fr/go'], 'the other host was never asked');
    r = await IO.fetchText('https://evil.example/', { lookup: pub, hosts, fetchImpl: async () => { throw new Error('must not be called'); } });
    assert.equal(r.code, 'E_HOST', 'a first address outside the list: no request at all');
    r = await IO.fetchText('https://tabular-api.data.gouv.fr/x', { lookup: pub, hosts, fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) });
    assert.equal(r.ok, true, 'an allowed host still reads');
  });

  // ---------------------------------------------------------------- web search v2 (2026-10-05): io.ts + webSearch.ts
  /** A loopback HTTP server for one test; `routes[path](req, res)`. Resolves {port, close, seen}. */
  const serve = async (/** @type {Record<string, (req: any, res: any) => void>} */ routes) => {
    const http = require('http');
    /** @type {{path: string, host: string}[]} */ const seen = [];
    const sockets = new Set();
    const srv = http.createServer((req, res) => {
      const p = String(req.url).split('?')[0];
      seen.push({ path: p, host: String(req.headers.host) });
      (routes[p] || ((_q, s) => { s.writeHead(404); s.end('no'); }))(req, res);
    });
    srv.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    return { port: srv.address().port, seen, close: () => { for (const s of sockets) s.destroy(); srv.close(); } };
  };
  const webFixture = (/** @type {string} */ name) => fs.readFileSync(path.join(WEB_FIXTURES, name), 'utf8');

  test('io.privateAddress: web search reads the public internet only — exactly 192.0.0/24 and 192.0.2/24, not all of 192.0/16', () => {
    const IO = require(path.join(BUILD, 'io.js'));
    const table = {
      '192.0.66.31': false, '192.0.2.1': true, '192.0.0.8': true, '192.0.1.1': false, '8.8.8.8': false, '93.184.216.34': false,
      '10.10.16.58': true, '172.16.0.1': true, '172.31.255.255': true, '172.32.0.1': false, '192.168.1.1': true,
      '100.64.0.1': true, '100.127.255.254': true, '100.128.0.1': false, '169.254.169.254': true, '127.0.0.1': true, '0.0.0.0': true,
      '198.18.0.1': true, '224.0.0.251': true, '239.255.43.10': true, '255.255.255.255': true,
      '::1': true, '::': true, 'fd00::1': true, 'fc12::1': true, 'fe80::1': true, 'ff02::1': true, '2001:db8::1': true,
      '2606:4700:4700::1111': false, '::ffff:10.0.0.1': true, '::ffff:8.8.8.8': false, '64:ff9b::a00:1': true, '64:ff9b::808:808': false,
      'fe80::1%eth0': true, 'not-an-ip': true,
    };
    for (const [ip, priv] of Object.entries(table)) assert.equal(IO.privateAddress(ip), priv, ip);
    const code = (u) => { const r = IO.checkUrl(u, false, true); return r.ok ? 'ok' : r.code; };
    assert.equal(code('http://192.168.1.40/'), 'E_LOCAL');
    assert.equal(code('http://[fd00::1]/'), 'E_LOCAL');
    assert.equal(code('http://[::ffff:10.0.0.1]/'), 'E_LOCAL', 'a mapped LAN address, in the hex form the URL parser makes');
    assert.equal(code('http://192.0.66.31/'), 'ok');
    assert.equal(IO.checkUrl('http://192.168.1.40/').ok, true, 'without publicOnly the LAN stays reachable (the Fetch box)');
  });

  test('io.fetchText publicOnly: a name that resolves to the LAN, a LAN literal and a redirect to one are refused before any request', async () => {
    const IO = require(path.join(BUILD, 'io.js'));
    const never = async () => { throw new Error('must not be called'); };
    const ok = (body = '<p>hi</p>') => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
    const lan = async () => [{ address: '10.0.0.5' }];
    let r = await IO.fetchText('https://intranet.example/', { publicOnly: true, lookup: lan, fetchImpl: never });
    assert.deepEqual([r.ok, r.code], [false, 'E_LOCAL']);
    r = await IO.fetchText('https://intranet.example/', { lookup: lan, fetchImpl: async () => ok() });
    assert.equal(r.ok, true, 'the Fetch box still reaches a LAN device');
    r = await IO.fetchText('http://192.168.1.40/', { publicOnly: true, fetchImpl: never });
    assert.equal(r.code, 'E_LOCAL');
    /** @type {string[]} */ const asked = [];
    r = await IO.fetchText('https://news.example/a', { publicOnly: true, lookup: async () => [{ address: '93.184.216.34' }],
      fetchImpl: async (u) => { asked.push(String(u)); return new Response(null, { status: 302, headers: { location: 'http://10.1.2.3/admin' } }); } });
    assert.deepEqual([r.code, asked], ['E_LOCAL', ['https://news.example/a']], 'the redirect to the LAN is never followed');
    r = await IO.fetchText('https://cgnat.example/', { publicOnly: true, lookup: async () => [{ address: '93.184.216.34' }, { address: '100.70.0.1' }], fetchImpl: never });
    assert.equal(r.code, 'E_LOCAL', 'one private address among the answers is enough to refuse');
    r = await IO.fetchText('http://192.0.66.31/', { publicOnly: true, fetchImpl: async () => ok() });
    assert.equal(r.ok, true);
  });

  test('io.fetchText: truncate keeps the top of a big page; the charset comes from the header, else the page\'s <meta>, else UTF-8', async () => {
    const IO = require(path.join(BUILD, 'io.js'));
    const pub = async () => [{ address: '93.184.216.34' }];
    const big = 'x'.repeat(5000);
    let r = await IO.fetchText('https://a.example/big', { lookup: pub, truncate: true, maxBytes: 1000,
      fetchImpl: async () => new Response(big, { status: 200, headers: { 'content-type': 'text/html', 'content-length': '5000' } }) });
    assert.deepEqual([r.ok, r.truncated, r.bytes, r.text.length], [true, true, 1000, 1000]);
    r = await IO.fetchText('https://a.example/big', { lookup: pub, maxBytes: 1000, fetchImpl: async () => new Response(big, { status: 200, headers: { 'content-type': 'text/html' } }) });
    assert.equal(r.code, 'E_SIZE', 'without truncate: refused, as before');
    r = await IO.fetchText('https://a.example/small', { lookup: pub, fetchImpl: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) });
    assert.equal(r.truncated, undefined, 'a page that fits says nothing about truncation');
    const latin = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80]);   // "café €" in windows-1252
    r = await IO.fetchText('https://a.example/fr', { lookup: pub, fetchImpl: async () => new Response(latin, { status: 200, headers: { 'content-type': 'text/plain; charset=windows-1252' } }) });
    assert.equal(r.text, 'café €');
    const meta = Buffer.concat([Buffer.from('<html><head><meta charset="iso-8859-1"></head><body>'), Buffer.from([0x63, 0x61, 0x66, 0xe9])]);
    r = await IO.fetchText('https://a.example/m', { lookup: pub, fetchImpl: async () => new Response(meta, { status: 200, headers: { 'content-type': 'text/html' } }) });
    assert.ok(r.text.endsWith('café'), r.text);
    r = await IO.fetchText('https://a.example/u', { lookup: pub, fetchImpl: async () => new Response('café', { status: 200, headers: { 'content-type': 'text/plain' } }) });
    assert.equal(r.text, 'café', 'no charset: UTF-8, as before');
    r = await IO.fetchText('https://a.example/x', { lookup: pub, fetchImpl: async () => new Response('café', { status: 200, headers: { 'content-type': 'text/plain; charset=no-such-thing' } }) });
    assert.equal(r.text, 'café', 'an unknown charset falls back to UTF-8');
  });

  test('io.fetchText connects to the address it checked (no second DNS answer), decompresses, and its time limit covers DNS', async () => {
    const IO = require(path.join(BUILD, 'io.js'));
    const zlib = require('zlib');
    const page = '<html><body><p>pinned and gzipped: ça marche</p></body></html>';
    const fx = await serve({
      '/gz': (_q, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' }); res.end(zlib.gzipSync(page)); },
      '/br': (_q, res) => { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'br' }); res.end(zlib.brotliCompressSync(page)); },
      '/go': (_q, res) => { res.writeHead(302, { location: '/gz' }); res.end(); },
    });
    try {
      /** @type {string[]} */ const asked = [];
      // pinned.test does not exist in any DNS: the request can only reach the fixture through the checked answer.
      const lookup = async (/** @type {string} */ h) => { asked.push(h); return [{ address: '127.0.0.1' }]; };
      let r = await IO.fetchText(`http://pinned.test:${fx.port}/go`, { lookup, allowLoopback: true });
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.text, page);
      assert.equal(r.url, `http://pinned.test:${fx.port}/gz`);
      assert.deepEqual(asked, ['pinned.test', 'pinned.test'], 'resolved once per hop');
      assert.deepEqual(fx.seen.map((s) => s.host), [`pinned.test:${fx.port}`, `pinned.test:${fx.port}`]);
      r = await IO.fetchText(`http://127.0.0.1:${fx.port}/br`, { allowLoopback: true });
      assert.equal(r.text, page, 'brotli too');
      r = await IO.fetchText(`http://127.0.0.1:${fx.port}/gz`);
      assert.equal(r.code, 'E_LOCAL', 'without the test switch, this machine is refused as before');
      const t0 = Date.now();
      r = await IO.fetchText('https://slow-dns.test/', { lookup: () => new Promise(() => {}), timeoutMs: 150 });
      assert.equal(r.code, 'E_TIMEOUT');
      assert.ok(Date.now() - t0 < 2000, 'a resolver that never answers does not outlive the time limit');
    } finally { fx.close(); }
  });

  test('io.fetchText: a status a fetch Response cannot hold (LinkedIn\'s 999) is an HTTP refusal with its code, not a network error', async () => {
    const IO = require(path.join(BUILD, 'io.js'));
    const fx = await serve({
      '/999': (_q, res) => { res.writeHead(999, { 'content-type': 'text/html' }); res.end('<p>Request denied</p>'); },
      '/403': (_q, res) => { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Forbidden here'); },
    });
    try {
      let r = await IO.fetchText(`http://127.0.0.1:${fx.port}/999`, { allowLoopback: true });
      assert.deepEqual([r.ok, r.code, r.status, r.message], [false, 'E_HTTP', 999, `http://127.0.0.1:${fx.port}/999`], JSON.stringify(r));
      r = await IO.fetchText(`http://127.0.0.1:${fx.port}/403`, { allowLoopback: true });
      assert.deepEqual([r.code, r.status, r.detail], ['E_HTTP', 403, 'Forbidden here'], 'an ordinary refusal reads as before');
    } finally { fx.close(); }
  });

  test('webSearch.extract: nav, header, cookie banner, share buttons, footer and scripts dropped; a table row kept; the dates read', () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    const dl = WS.extract(webFixture('download.html'));
    const text = dl.blocks.map((b) => b.t).join('\n');
    assert.equal(dl.title, 'Download Quill — the free text editor');
    assert.equal(dl.description, 'Download Quill 7.2 LTS for Windows, macOS and Linux.');
    assert.deepEqual([dl.published, dl.newest], ['published 2019-05-02, updated 2026-09-15', '2026-09-15'], 'from the JSON-LD');
    assert.match(text, /The current stable version is Quill 7\.2\.1, released on 15 September 2026/);
    for (const junk of [/cookies/i, /Features/, /Support the latest/, /Share on Social/, /Quill Foundation/, /Quill 1\.0/, /position: fixed/]) assert.doesNotMatch(text, junk);
    assert.ok(dl.blocks.some((b) => b.h && b.t === 'Experimental builds'), 'headings are kept as headings');
    const wiki = WS.extract(webFixture('wiki.html'));
    const wtext = wiki.blocks.map((b) => b.t).join('\n');
    assert.ok(wiki.blocks.some((b) => b.t === '7.2.1 | 2026-09-15 | Current stable version (LTS)'), 'a table row is one "a | b | c" line');
    assert.deepEqual([wiki.published, wiki.newest], ['updated 2026-09-20', '2026-09-20'], 'from article:modified_time');
    assert.doesNotMatch(wtext, /last edited|Random article|1 History/, 'footer, navigation and the table of contents dropped');
    const blog = WS.extract(webFixture('blog.html'));
    assert.deepEqual([blog.published, blog.newest], ['published 2024-03-01', '2024-03-01']);
    assert.doesNotMatch(blog.blocks.map((b) => b.t).join('\n'), /Quill 5 review|Tags/, 'the related box and the navbar dropped');
    const timeOnly = WS.extract('<html><body><article><time datetime="1889-03-31">31 March 1889</time><p>The tower opened in 1889 and is 330 metres tall today.</p></article></body></html>');
    assert.deepEqual([timeOnly.published, timeOnly.newest], ['dated 1889-03-31', ''], 'a bare <time> is shown, never used as the page\'s own date');
  });

  test('webSearch.extract: linear on a hostile page (no closing ">", unclosed comment, CDATA, doctype, quote); the fixtures read exactly as before', () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    const crypto = require('crypto');
    // b7829c2's output on the four fixtures (sha256 of the JSON, 16 hex): the linear tokenizer changed nothing on them.
    const before = { 'download.html': '836bb6510b6f5b37', 'wiki.html': '7c0651e02db870c4', 'blog.html': 'a05af86d0e097fe5', 'dictionary.html': 'fcf992a91d2635b9' };
    for (const [file, hash] of Object.entries(before)) {
      assert.equal(crypto.createHash('sha256').update(JSON.stringify(WS.extract(webFixture(file)))).digest('hex').slice(0, 16), hash, file);
    }
    // Pages are untrusted and this runs on the main process. Before: 64 KB of "<a" took 1.9 s, and the time grew
    // with the square of the size (a 2 MB page: about half an hour). Now each of these is a single pass.
    const hostile = {
      'no closing ">"': (/** @type {number} */ n) => '<a'.repeat(n / 2),
      'a tag name that never ends': (/** @type {number} */ n) => '<a' + 'b'.repeat(n),
      'unclosed comments': (/** @type {number} */ n) => '<!--'.repeat(n / 4),
      'unclosed CDATA': (/** @type {number} */ n) => '<![CDATA['.repeat(n / 9),
      'unclosed doctypes': (/** @type {number} */ n) => '<!doctype'.repeat(n / 9),
      'unclosed "<?"': (/** @type {number} */ n) => '<?'.repeat(n / 2),
      'unclosed quotes': (/** @type {number} */ n) => '<a x="'.repeat(n / 6),
    };
    for (const [name, make] of Object.entries(hostile)) {
      for (const [kb, limitMs] of [[64, 300], [2048, 4000]]) {
        const page = make(kb * 1024);
        const t0 = process.hrtime.bigint();
        WS.extract(page);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        assert.ok(ms < limitMs, `${name}, ${kb} KB: ${ms.toFixed(0)} ms (limit ${limitMs})`);
      }
    }
    const text = (/** @type {string} */ html) => WS.extract(html).blocks.map((b) => b.t);
    assert.deepEqual(text('<p>first 1</p><!-- a comment --><p>second 2</p><![CDATA[ x < y ]]><p>third 3</p>'), ['first 1', 'second 2', 'third 3']);
    assert.deepEqual(text('<p>kept 1</p><!-- never closed <p>hidden 2</p>'), ['kept 1'], 'an unclosed comment runs to the end of the page, as in a browser');
    assert.deepEqual(text('<p>kept 1</p><![CDATA[ never closed <p>hidden 2</p>'), ['kept 1']);
    // A stray quote in a tag (seen on a real page): the tag ends at its '>' and its text is read, no markup leaks.
    assert.deepEqual(text('<p><span style="color:#fff";font-size:1em;">Septembre 2026</span></p>'), ['Septembre 2026']);
  });

  test('webSearch.passages: each sentence counted once — the same passages as before, on the fixtures and on random text', () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    // b7829c2's passages(), as it was: it re-split the growing part for every sentence (a 2 MB block of one-word
    // sentences: 1.2 s; now 0.15 s).
    const before = (/** @type {{t: string, h: boolean}[]} */ blocks, maxWords = 160, minWords = 60) => {
      /** @type {{text: string, head: string}[]} */ const out = []; /** @type {string[]} */ let cur = []; let words = 0; let head = '';
      const push = () => { if (cur.length) out.push({ text: cur.join('\n'), head }); cur = []; words = 0; };
      for (const b of blocks) {
        if (b.h) { push(); head = b.t.slice(0, 160); continue; }
        const w = b.t.split(/\s+/).length;
        if (w > maxWords) {
          push();
          let part = '';
          for (const s of b.t.split(/(?<=[.!?…])\s+/)) {
            if ((part + ' ' + s).split(/\s+/).length > maxWords && part) { out.push({ text: part.trim(), head }); part = ''; }
            part += ' ' + s;
          }
          if (part.trim()) out.push({ text: part.trim().slice(0, maxWords * 12), head });
          continue;
        }
        cur.push(b.t); words += w;
        if (words >= minWords) push();
      }
      push();
      return out;
    };
    for (const f of ['download.html', 'wiki.html', 'blog.html', 'dictionary.html']) {
      const blocks = WS.extract(webFixture(f)).blocks;
      assert.deepEqual(WS.passages(blocks), before(blocks), f);
      assert.deepEqual(WS.passages(blocks, 12, 4), before(blocks, 12, 4), `${f}, short passages`);
    }
    // Random blocks with every kind of white space at either end (the count must merge runs exactly as split does).
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = (/** @type {string[]} */ a) => a[Math.floor(rnd() * a.length)];
    const WORDS = ['Quill', '7.2.1', 'stable', 'la', 'version', 'é', 'x', 'Ça'];
    const SEPS = [' ', ' ', ' ', '  ', '\t', '\n', ' ', ' \n '];
    const ENDS = ['', '', '', '.', '!', '?', '…', '...'];
    for (let i = 0; i < 400; i++) {
      /** @type {{t: string, h: boolean}[]} */ const blocks = [];
      for (let b = 0, nb = 1 + Math.floor(rnd() * 5); b < nb; b++) {
        if (rnd() < 0.15) { blocks.push({ t: `Heading ${b}`, h: true }); continue; }
        let t = rnd() < 0.2 ? pick(SEPS) : '';
        for (let w = 0, nw = Math.floor(rnd() * 300); w < nw; w++) t += pick(WORDS) + pick(ENDS) + pick(SEPS);
        blocks.push({ t: rnd() < 0.5 ? t.trimEnd() : t, h: false });
      }
      for (const [maxWords, minWords] of [[160, 60], [20, 5]]) {
        assert.deepEqual(WS.passages(blocks, maxWords, minWords), before(blocks, maxWords, minWords), `random case ${i} (${maxWords}/${minWords})`);
      }
    }
    // A loose bound, so the re-splitting loop cannot come back unnoticed: a page-cap block of 700k one-word sentences
    // (2026-10-06, this box: 0.15 s now, 1.15 s with the loop above).
    const block = [{ t: 'x. '.repeat(700_000).trim(), h: false }];
    const t0 = performance.now();
    assert.equal(WS.passages(block).length, 4403);
    const ms = performance.now() - t0;
    assert.ok(ms < 700, `700k one-word sentences: ${ms.toFixed(0)} ms (limit 700)`);
  });

  test('webSearch.rank on a stored SearXNG answer: the answer passage chosen, the budgets held, a page with no evidence dropped', () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    const sx = JSON.parse(webFixture('searxng.json'));
    const picked = WS.pickPages(sx.results);
    assert.deepEqual(picked.map((r) => new URL(r.url).hostname), ['blog.example', 'quill.example', 'wiki.example', 'quill.example', 'slow.example', 'dictionary.example'],
      'SearXNG\'s order, the dictionary page last, at most two pages from one site (the forum, a third from quill.example, is left out), six in all');
    const files = { 'https://blog.example/2024/03/quill-6-is-here': 'blog.html', 'https://quill.example/download/': 'download.html', 'https://dictionary.example/definition/quill': 'dictionary.html', 'https://wiki.example/wiki/Quill_(editor)': 'wiki.html' };
    const pages = picked.map((r) => (files[r.url] ? { ok: true, url: r.url, ...WS.extract(webFixture(files[r.url])) } : { ok: false }));   // news and slow: not read
    const now = Date.parse('2026-10-05T12:00:00Z');
    for (const q of ['Quill latest stable version', 'Quill stable version', 'quill dernière version stable']) {
      const r = WS.rank(q, picked, pages, 5, { now });
      const links = r.out.map((o) => o.link);
      assert.ok(r.out.some((o) => o.snippet.includes('Quill 7.2.1')), `${q}: the answer is in what the model reads`);
      assert.ok(!links.includes('https://dictionary.example/definition/quill'), `${q}: the dictionary page has no evidence and is dropped`);
      assert.ok(!links.includes('https://quill.example/news/') && !links.includes('https://slow.example/quill-tips'), `${q}: unread pages with no evidence are dropped too`);
      assert.ok(r.tokens <= 3000, `${q}: ${r.tokens} tokens in all`);
      for (const o of r.out) assert.ok(WS.tokensOf(o.snippet) <= 800 + 10, `${q}: ${o.link} ${WS.tokensOf(o.snippet)} tokens`);
      assert.ok(r.out.every((o) => o.title && o.link.startsWith('https://')));
    }
    const wikiAll = WS.tokensOf(pages[picked.findIndex((r) => r.url.includes('wiki.example'))].blocks.map((b) => b.t).join('\n'));
    const wikiOut = WS.rank('quill dernière version stable', picked, pages, 5, { now }).out.find((o) => o.link.includes('wiki.example'));
    assert.ok(wikiAll > 850 && WS.tokensOf(wikiOut.snippet) <= 810, `the long page (${wikiAll} tokens) is cut to its best passages (${WS.tokensOf(wikiOut.snippet)})`);
    assert.match(wikiOut.snippet, /^\(updated 2026-09-20\)/, 'the page\'s date leads its snippet');
    // A search whose pages all failed still answers with the engines' own snippets.
    const none = WS.rank('Quill latest stable version', picked, picked.map(() => ({ ok: false })), 5, { now });
    assert.ok(none.out.length >= 1 && none.out[0].snippet.includes('Quill'));
  });

  test('webSearch.rank: when the question asks for the latest, a page dated over a year ago comes after current ones', () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    const sx = JSON.parse(webFixture('searxng.json'));
    const picked = WS.pickPages(sx.results);
    const files = { 'https://blog.example/2024/03/quill-6-is-here': 'blog.html', 'https://quill.example/download/': 'download.html', 'https://wiki.example/wiki/Quill_(editor)': 'wiki.html' };
    const pages = picked.map((r) => (files[r.url] ? { ok: true, url: r.url, ...WS.extract(webFixture(files[r.url])) } : { ok: false }));
    const first = (q, now) => new URL(WS.rank(q, picked, pages, 5, { now: Date.parse(now) }).out[0].link).hostname;
    const order = (q, now) => WS.rank(q, picked, pages, 5, { now: Date.parse(now) }).out.map((o) => new URL(o.link).hostname);
    // Without a recency word the stale 2024 blog post, stuffed with the question's words, ranks first ...
    assert.equal(first('Quill stable version', '2026-10-05'), 'blog.example');
    // ... with one, it goes after the pages updated this year — in English and in French.
    for (const q of ['Quill latest stable version', 'quill dernière version stable', 'Quill stable version now', 'version actuelle de Quill stable', 'Quill stable version aujourd’hui']) {
      const o = order(q, '2026-10-05');
      assert.notEqual(o[0], 'blog.example', q);
      assert.equal(o[o.length - 1], 'blog.example', `${q}: ${o.join(', ')}`);
    }
    // The rule follows the page's date, not the words alone: in June 2024 that post was current.
    assert.equal(first('Quill latest stable version', '2024-06-01'), 'blog.example');
  });

  test('webSearch.rank: on a version question, a line with a version number next to "current", "stable", "LTS"… survives the cut', () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    const advice = 'Picking the latest stable version of Quill matters: the latest stable version is the one to install, and a stable version gets the fixes first. Use the latest stable version in class.';
    const read = (/** @type {string} */ line, /** @type {string} */ q, newest = '') => {
      const picked = [{ url: 'https://quill.example/releases/', title: 'Quill releases', content: '' }, { url: 'https://blog.example/quill', title: 'Which Quill to install', content: '' }];
      const page = (/** @type {number} */ i, /** @type {{t: string, h: boolean}[]} */ blocks, nw = '') => ({ ok: true, url: picked[i].url, title: picked[i].title, published: '', newest: nw, description: '', blocks });
      const pages = [
        page(0, [{ t: 'Releases', h: true }, { t: line, h: false }, { t: 'Older', h: true }, { t: 'Every Quill version ever released can be downloaded from the archive page.', h: false }], newest),
        page(1, [{ t: 'Advice', h: true }, { t: advice, h: false }, { t: 'More', h: true }, { t: advice.replace('in class', 'at home'), h: false }]),
      ];
      return WS.rank(q, picked, pages, 5, { now: Date.parse('2026-10-06') }).out.some((o) => o.snippet.includes(line));
    };
    // The blog's passages, full of the question's words, set the bar; the releases line names the version.
    assert.equal(read('Quill 7.2.1 (current stable), 15 September 2026.', 'Quill latest stable version'), true, 'the version line is read');
    assert.equal(read('Quill (current stable), 15 September 2026.', 'Quill latest stable version'), false, 'the same line without a version number is cut: the number is what counts');
    // A dotted date is not a version number (it was: "06.10.2026" lifted this line like "7.2.1").
    assert.equal(read('Quill (current stable), 06.10.2026.', 'Quill latest stable version'), false, 'a dotted date is not boosted');
    // A stale page's line counts half and is not lifted back: on a page updated this year it is read, on one last
    // updated in 2024 it is cut (doubled, it passed the bar a fresh page's passage sets).
    const line = 'Quill 7.2.1 (latest stable), 15 September 2026.';
    assert.equal(read(line, 'Quill latest stable version', '2026-09-15'), true, 'a fresh page\'s version line is read');
    assert.equal(read(line, 'Quill latest stable version', '2024-01-10'), false, 'a stale page\'s version line does not outrank the fresh passages');
  });

  test('webSearch.rank: the "now" words say when, not what — they no longer pull a page whose title holds them', () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    // The live replay (2026-10-06): with the dictionaries gone, "aujourd'hui" put a TV show above the minister's page.
    const picked = [{ url: 'https://ministere.example/ministre', title: 'Ministère de la Culture — la ministre', content: '' },
      { url: 'https://podcasts.example/show', title: "Ça commence aujourd'hui", content: '' }];
    const page = (/** @type {number} */ i, /** @type {string[]} */ texts) => ({ ok: true, url: picked[i].url, title: picked[i].title, published: '', newest: '', description: '',
      blocks: texts.flatMap((t, k) => [{ t: `Part ${k}`, h: true }, { t, h: false }]) });
    // Many passages share "ministre" and "Culture" (common, so they weigh little); the show's title alone holds the rare
    // "aujourd'hui" — as a term it put every passage of the show first and the minister's page under the floor.
    const pages = [
      page(0, ['Catherine Pégard est ministre de la Culture depuis le 26 février 2026.', 'La ministre de la Culture présente le budget du ministère.',
        'Le ministre de la Culture de 1959 à 1969 fut André Malraux.', 'Jack Lang, ministre de la Culture, lance la Fête de la musique en 1982.',
        'Le ministère de la Culture compte des directions régionales.', 'La ministre de la Culture préside la commission du patrimoine.']),
      page(1, ["Tous les jours, l'émission accueille des invités qui racontent leur histoire, diffusée à 13h55.", 'Des témoignages forts, du lundi au vendredi, à 13h55.']),
    ];
    const r = WS.rank("Qui est ministre de la Culture en France aujourd'hui ?", picked, pages, 5, { now: Date.parse('2026-10-06') });
    assert.ok(r.out[0].link === picked[0].url && /Pégard/.test(r.out[0].snippet), JSON.stringify(r.out.map((o) => o.link)));
    assert.ok(!r.out.some((o) => o.link === picked[1].url), 'the show has no evidence once "aujourd\'hui" is not a search term');
    // The same word with a typographic apostrophe (’, as phones and word processors type it; ‘ and ʼ too).
    for (const apo of ['’', '‘', 'ʼ']) {
      const typed = WS.rank(`Qui est ministre de la Culture en France aujourd${apo}hui ?`, picked, pages, 5, { now: Date.parse('2026-10-06') });
      assert.deepEqual(typed.out.map((o) => o.link), r.out.map((o) => o.link), `aujourd${apo}hui is a "now" word too`);
    }
    // A question made only of such words still ranks (on them).
    assert.ok(WS.rank("aujourd'hui", picked, pages, 5).out.length >= 1);
  });

  test('webSearch.pickPages: dictionary and translation pages come after every other result — read only when nothing else came back', () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    const dictionaries = ['https://www.linguee.fr/anglais-francais/traduction/latest.html', 'https://www.larousse.fr/dictionnaires/francais/combien/17379',
      'https://dictionnaire.lerobert.com/definition/qui', 'https://www.wordreference.com/enfr/latest', 'https://context.reverso.net/traduction/anglais-francais/latest',
      'https://fr.wiktionary.org/wiki/vainqueur', 'https://translate.google.com/?sl=en&tl=fr', 'https://www.deepl.com/translator',
      'https://dictionary.cambridge.org/dictionary/english/latest', 'https://www.merriam-webster.com/dictionary/latest', 'https://www.dictionary.com/browse/latest',
      'https://www.collinsdictionary.com/dictionary/english/latest', 'https://leconjugueur.lefigaro.fr/conjugaison/verbe/renouveler.html',
      // seen in the re-check's French searches, from a question's "qui", "quel" or "combien"
      'https://www.lalanguefrancaise.com/dictionnaire/definition/qui', 'https://www.dictionnaire-academie.fr/article/A9Q0222', 'https://www.linternaute.fr/dictionnaire/fr/definition/qui/',
      'https://www.le-dictionnaire.com/definition/combien', 'https://www.projet-voltaire.fr/regles-orthographe/quel-quelle-qu-elle/', 'https://conjugaison.bescherelle.com/verbes/renouveler'];
    const others = ['https://www.blender.org/download/', 'https://www.larousse.fr/encyclopedie/divers/Tour_de_France/147506', 'https://en.wikipedia.org/wiki/Blender_(software)',
      'https://news.example/2026/10/translation-ai-startup-raises', 'https://dictionary-of-things.example/x', 'https://a.example/1', 'https://c.example/3'];
    const r = (/** @type {string} */ url) => ({ url, title: url, content: '' });
    // SearXNG's order mixes them; the six slots go to the others, in SearXNG's order (Larousse's encyclopedia is not its
    // dictionary; a slug or a host that only contains the word is not one either).
    const mixed = dictionaries.flatMap((d, i) => [d, others[i]].filter(Boolean)).map(r);
    assert.deepEqual(WS.pickPages(mixed).map((x) => x.url), others.slice(0, 6));
    // Nothing else came back (a question about a word): the dictionaries are read, two per site at most as ever.
    assert.deepEqual(WS.pickPages(dictionaries.map(r)).map((x) => x.url), dictionaries.slice(0, 6));
    assert.deepEqual(WS.pickPages([dictionaries[0], others[4]].map(r)).map((x) => x.url), [others[4], dictionaries[0]]);
    // One by one (2026-10-06): a dictionary's NAME is a host label, its WORD a folder; a translation API's docs and a
    // dictionary type's page keep their slot, and the French sites the stored searches held still go last.
    const last = (/** @type {string} */ url) => WS.pickPages([url, 'https://neutral.example/'].map(r))[0].url !== url;
    const docs = ['https://cloud.google.com/translate/docs/overview', 'https://docs.aws.amazon.com/translate/latest/dg/what-is.html',
      'https://learn.microsoft.com/en-us/azure/ai-services/translator/overview', 'https://docs.djangoproject.com/en/5.2/topics/i18n/translation/',
      'https://developer.apple.com/documentation/swift/dictionary', 'https://support.google.com/translate/answer/6350850'];
    for (const url of [...docs, ...others]) assert.equal(last(url), false, `${url} keeps its slot`);
    const french = ['https://www.lalanguefrancaise.com/conjugaison', 'https://www.lalanguefrancaise.com/orthographe/nouvel-ou-nouveau-orthographe',
      'https://www.xn--cours-franais-rgb.fr/francais/orthographe/homophones/quel-quelle-qu-elle-qu-elles/', 'https://www.cnrtl.fr/definition/qui',
      'https://dictionnaire.reverso.net/francais-definition/qui', 'https://www.larousse.fr/conjugaison/francais/renouveler/7339'];
    for (const url of [...dictionaries, ...french]) assert.equal(last(url), true, `${url} goes last`);
  });

  test('/web/search: the bearer, the Host, POST only, the body cap; SearXNG down or silent is answered within the deadline', async () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    const http = require('http');
    // A port nothing listens on, and a SearXNG that accepts and never answers.
    const gone = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    const silent = await serve({ '/search': () => { /* never answers */ } });
    let searxng = `http://127.0.0.1:${gone}`;
    /** @type {any[]} */ const calls = [];
    const deps = { token: 'web-token', version: '0', tools: () => MCP.TOOLS, call: async () => ({ text: '' }),
      webSearch: (q, n) => { calls.push([q, n]); return WS.searchAndRead(q, n, { searxngUrl: searxng, deadlineMs: 600 }); } };
    const srv = await MCP.startMcpServer(deps, 0);
    const port = srv.address().port;
    const raw = (/** @type {Record<string, string>} */ headers, /** @type {string} */ body, method = 'POST') => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/web/search', method, headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', ...headers } },
        (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: t })); });
      req.on('error', (e) => resolve({ status: 0, error: e.code }));
      req.end(body);
    });
    const auth = { authorization: 'Bearer web-token' };
    try {
      assert.equal((await raw({}, '{"query":"x"}')).status, 401);
      assert.equal((await raw({ authorization: 'Bearer wrong-token' }, '{"query":"x"}')).status, 401);
      assert.equal((await raw({ ...auth, host: `evil.example:${port}` }, '{"query":"x"}')).status, 403, 'a rebound name is refused, bearer or not');
      assert.equal((await raw(auth, '', 'GET')).status, 405);
      assert.equal((await raw(auth, 'not json')).status, 400);
      assert.equal((await raw(auth, '{"count":3}')).status, 400, 'no query');
      const big = await raw(auth, JSON.stringify({ query: 'x'.repeat(100 * 1024) }));
      assert.ok(big.status === 413 || big.status === 0, `over 64 KB: refused (${big.status || big.error})`);
      assert.equal(calls.length, 0, 'nothing above reached the search');
      let t0 = Date.now();
      let r = await raw(auth, JSON.stringify({ query: 'quill', count: 50 }));
      assert.equal(r.status, 502, 'SearXNG down: an error Open WebUI reads as no results ' + JSON.stringify(r));
      assert.ok(Date.now() - t0 < 2000, 'and at once');
      assert.deepEqual(calls[0], ['quill', 10], 'the count is capped');
      searxng = `http://127.0.0.1:${silent.port}`;
      t0 = Date.now();
      r = await raw(auth, JSON.stringify({ query: 'quill' }));
      const took = Date.now() - t0;
      assert.equal(r.status, 502);
      assert.ok(took >= 500 && took < 2500, `a silent SearXNG is answered at the deadline (${took} ms), never left hanging`);
      assert.doesNotMatch(r.body, /quill/, 'the error never carries the question');
      // The MCP door on the same listener is unchanged; a listener without webSearch has no /web/search.
      const bare = await MCP.startMcpServer({ token: 't', version: '0', tools: () => MCP.TOOLS, call: async () => ({ text: '' }) }, 0);
      try {
        const res = await fetch(`http://127.0.0.1:${bare.address().port}/web/search`, { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{"query":"x"}' });
        assert.equal(res.status, 404);
      } finally { bare.close(); }
    } finally { srv.close(); silent.close(); }
  });

  test('web search end to end: a mock SearXNG and fixture pages on 127.0.0.1, through the listener, within the deadline', async () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    const zlib = require('zlib');
    const html = (/** @type {string} */ name, gzip = false) => (_q, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...(gzip ? { 'content-encoding': 'gzip' } : {}) });
      res.end(gzip ? zlib.gzipSync(webFixture(name)) : webFixture(name));
    };
    /** @type {any} */ let asked = null;
    const pagesSrv = await serve({ '/download': html('download.html'), '/wiki': html('wiki.html', true), '/blog': html('blog.html'), '/news': html('download.html'), '/slow': () => { /* never answers */ } });
    // The stored SearXNG answer, its pages moved onto the fixture server: two "sites" (127.0.0.1 and localhost) of two pages each.
    const at = { 'blog.example': 'localhost', 'quill.example/download': '127.0.0.1', 'wiki.example': '127.0.0.1', 'quill.example/news': '127.0.0.1', 'slow.example': 'localhost' };
    const pathOf = { 'blog.example': '/blog', 'quill.example/download': '/download', 'wiki.example': '/wiki', 'quill.example/news': '/news', 'slow.example': '/slow' };
    const sx = JSON.parse(webFixture('searxng.json'));
    sx.results = sx.results.flatMap((r) => {
      const k = Object.keys(at).find((key) => r.url.includes(key));
      return k ? [{ ...r, url: `http://${at[k]}:${pagesSrv.port}${pathOf[k]}` }] : [];
    });
    const searx = await serve({ '/search': (req, res) => {
      asked = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(sx));
    } });
    const srv = await MCP.startMcpServer({ token: 'e2e', version: '0', tools: () => MCP.TOOLS, call: async () => ({ text: '' }),
      // loopback allowed ONLY here: the fixture pages live on this machine
      webSearch: (q, n) => WS.searchAndRead(q, n, { searxngUrl: `http://127.0.0.1:${searx.port}/`, deadlineMs: 2500, allowLoopback: true }) }, 0);
    try {
      const t0 = Date.now();
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/web/search`, { method: 'POST', headers: { authorization: 'Bearer e2e', 'content-type': 'application/json' }, body: JSON.stringify({ query: 'Quill latest stable version', count: 5 }) });
      const took = Date.now() - t0;
      assert.equal(res.status, 200);
      const out = await res.json();
      assert.deepEqual(asked, { q: 'Quill latest stable version', format: 'json', language: 'auto', safesearch: '1' });
      assert.ok(Array.isArray(out) && out.length >= 2 && out.length <= 5);
      for (const o of out) assert.deepEqual(Object.keys(o).sort(), ['link', 'snippet', 'title'], 'Open WebUI\'s external-search contract');
      assert.ok(out.some((o) => /The current stable version is Quill 7\.2\.1/.test(o.snippet)), 'read from the page, not the engine\'s snippet');
      assert.ok(out.some((o) => o.link.endsWith('/wiki') && /7\.2\.1 \| 2026-09-15/.test(o.snippet)), 'the gzipped page was read and its table kept');
      assert.ok(!/blog$/.test(out[0].link), 'the stale post does not lead');
      assert.ok(took < 2500 + 1500, `answered within the deadline although one page never answers (${took} ms)`);
      const paths = pagesSrv.seen.map((s) => s.path).sort();
      assert.deepEqual(paths, ['/blog', '/download', '/slow', '/wiki'], 'two pages a site: the third from 127.0.0.1 (/news) is never asked');
      assert.ok(pagesSrv.seen.some((s) => s.host === `localhost:${pagesSrv.port}`), 'a page found by name went through DNS and the pinned connection');
    } finally { srv.close(); searx.close(); pagesSrv.close(); }
  });

  test('web search: the pages are read and ranked in a worker — a hostile 2 MB page never holds the main thread; a late worker leaves the snippets', async () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    // 2 MB of "<a" (the page cap) gives no text and takes 0.8 s to read: on the main thread until 2026-10-06.
    const hostile = Buffer.from('<a'.repeat(1024 * 1024));
    const pagesSrv = await serve({
      '/hostile': (_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(hostile); },
      '/download': (_q, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(webFixture('download.html')); },
    });
    const results = [{ url: `http://127.0.0.1:${pagesSrv.port}/hostile`, title: 'Quill', content: 'Quill, a text editor.' },
      { url: `http://localhost:${pagesSrv.port}/download`, title: 'Download Quill', content: 'Download Quill for Windows.' }];
    const searx = await serve({ '/search': (_q, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ results })); } });
    const ask = (/** @type {number} */ workMs) => WS.searchAndRead('Quill latest stable version', 5, { searxngUrl: `http://127.0.0.1:${searx.port}`, deadlineMs: 5000, allowLoopback: true, workMs });
    try {
      // The longest the main thread went without a turn of its event loop while the search ran.
      let last = performance.now(); let longest = 0; let spin = true;
      const tick = () => { const t = performance.now(); longest = Math.max(longest, t - last); last = t; if (spin) setImmediate(tick); };
      setImmediate(tick);
      const out = await ask(30_000).finally(() => { spin = false; });
      assert.ok(longest < 100, `the main thread was held ${longest.toFixed(0)} ms at most (limit 100)`);
      assert.ok(out.some((o) => /The current stable version is Quill 7\.2\.1/.test(o.snippet)), 'the other page was read, in the worker');
      // A worker that has not answered in time: the engines' own snippets, as when no page could be read.
      const late = await ask(1);
      assert.deepEqual(late.map((o) => o.snippet).sort(), ['Download Quill for Windows.', 'Quill, a text editor.']);
    } finally { pagesSrv.close(); searx.close(); }
  });

  test('web search: main reads at most 4 MB of the farm\'s search answer — bigger, or endless, fails as "not JSON" at once', async () => {
    const WS = require(path.join(BUILD, 'webSearch.js'));
    const big = JSON.stringify({ results: [], pad: 'x'.repeat(5 * 1024 * 1024) });   // valid JSON, over the cap
    const chunk = Buffer.alloc(64 * 1024, 'x');
    const searx = await serve({ '/search': (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams.get('q');
      res.writeHead(200, { 'content-type': 'application/json' });
      if (q === 'big') return res.end(big);
      if (q === 'small') return res.end(JSON.stringify({ results: [] }));
      res.write('{"results":[], "pad":"');   // endless: writes as long as the client reads
      const more = () => { while (!res.destroyed && res.write(chunk)) { /* until the buffer is full */ } if (!res.destroyed) res.once('drain', more); };
      more();
    } });
    const ask = (/** @type {string} */ q) => WS.searchAndRead(q, 5, { searxngUrl: `http://127.0.0.1:${searx.port}`, deadlineMs: 8000 });
    try {
      await assert.rejects(ask('big'), /did not answer in JSON/);
      const t0 = Date.now();
      await assert.rejects(ask('endless'), /did not answer in JSON/);
      assert.ok(Date.now() - t0 < 3000, `an endless answer is cut at 4 MB, not at the 6 s time limit (${Date.now() - t0} ms)`);
      assert.deepEqual(await ask('small'), [], 'an ordinary answer still reads');
    } finally { searx.close(); }
  });

  test('configBridge web search: through main while the listener is up, else OWUI\'s own searxng engine with the measured knobs', () => {
    const base = { endpoint: 'http://10.0.0.5:4000/v1', dataDir: tempDir('web'), searxngUrl: 'http://10.0.0.5:8888/' };
    const keys = ['ENABLE_WEB_SEARCH', 'WEB_SEARCH_ENGINE', 'SEARXNG_QUERY_URL', 'SEARXNG_LANGUAGE', 'EXTERNAL_WEB_SEARCH_URL', 'EXTERNAL_WEB_SEARCH_API_KEY',
      'WEB_SEARCH_RESULT_COUNT', 'WEB_SEARCH_CONCURRENT_REQUESTS', 'WEB_FETCH_MAX_CONTENT_LENGTH', 'WEB_LOADER_ENGINE', 'EXTERNAL_WEB_LOADER_URL'];
    const web = (env) => Object.fromEntries(keys.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]));
    try {
      CB.setComputerMcp(null);   // the port was taken: OWUI asks SearXNG itself
      assert.deepEqual(web(CB.buildSidecarEnv(base)), {
        ENABLE_WEB_SEARCH: 'true', WEB_SEARCH_ENGINE: 'searxng', SEARXNG_QUERY_URL: 'http://10.0.0.5:8888/search?q=<query>', SEARXNG_LANGUAGE: 'auto',
        WEB_SEARCH_RESULT_COUNT: '5', WEB_SEARCH_CONCURRENT_REQUESTS: '10', WEB_FETCH_MAX_CONTENT_LENGTH: '12000',
      });
      CB.setComputerMcp({ url: 'http://127.0.0.1:41995/mcp', token: 'install-token' });
      const env = CB.buildSidecarEnv(base);
      assert.deepEqual(web(env), {
        ENABLE_WEB_SEARCH: 'true', WEB_SEARCH_ENGINE: 'external', EXTERNAL_WEB_SEARCH_URL: 'http://127.0.0.1:41995/web/search', EXTERNAL_WEB_SEARCH_API_KEY: 'install-token',
        WEB_SEARCH_RESULT_COUNT: '5', WEB_SEARCH_CONCURRENT_REQUESTS: '10', WEB_FETCH_MAX_CONTENT_LENGTH: '12000',
      }, 'no external page loader: attaching a LAN page keeps working (ENABLE_LOCAL_WEB_FETCH)');
      assert.equal(env.ENABLE_LOCAL_WEB_FETCH, 'true');
      assert.deepEqual(web(CB.buildSidecarEnv({ ...base, searxngUrl: null })), {}, 'a farm without SearXNG: no web search at all');
    } finally { CB.setComputerMcp(null); }
  });

  test('serial (critic S2, S4): serial only for the app\'s own page; no device pre-granted; everything else as Electron\'s default', () => {
    stubElectron();
    const S = require(path.join(BUILD, 'serial.js'));
    /** @type {any} */ let check = null;
    let deviceHandler = false;
    const ses = /** @type {any} */ ({
      setPermissionCheckHandler: (/** @type {any} */ fn) => { check = fn; },
      setDevicePermissionHandler: () => { deviceHandler = true; },
      on: () => {},
    });
    S.configureSerial(ses);
    assert.equal(check(null, 'serial', 'file:///', { securityOrigin: 'file:///' }), true, 'the app page may use serial');
    assert.equal(check(null, 'serial', 'null', { securityOrigin: 'null' }), false, 'the sandbox guest may not');
    assert.equal(check(null, 'deprecated-sync-clipboard-read', 'file:///', { securityOrigin: 'file:///' }), false);
    assert.equal(check(null, 'media', 'file:///', { securityOrigin: 'file:///' }), true, 'the rest stays as it was');
    assert.equal(deviceHandler, false, 'no device permission handler: a board is usable only once a person picked it');
    // The microphone and camera (2026-09-28): only the app's own page may ask.
    assert.equal(S.grantRequest('media', 'file:///C:/app/renderer/index.html'), true);
    assert.equal(S.grantRequest('media', 'null'), false, 'not the sandbox guest');
    assert.equal(S.grantRequest('media', 'http://127.0.0.1:8080/'), false, 'not a served page');
    assert.equal(S.grantRequest('notifications', 'http://x/'), true, 'the rest as Electron without a handler');
  });

  test('cleanup', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  });
};
