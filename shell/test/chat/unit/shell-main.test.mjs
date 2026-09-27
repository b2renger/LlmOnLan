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
const MODULES = ['farmSelect', 'discovery', 'configBridge', 'sidecar', 'sidecarManager', 'clientData', 'dataMigration', 'store', 'io', 'mcp', 'serial'];

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
  });

  test('cleanup', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  });
};
