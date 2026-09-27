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
const MODULES = ['farmSelect', 'discovery', 'configBridge', 'sidecar', 'sidecarManager'];

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
  const { SidecarSupervisor } = require(path.join(BUILD, 'sidecar.js'));
  const SM = require(path.join(BUILD, 'sidecarManager.js'));

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

  test('cleanup', () => {
    for (const d of temps) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
  });
};
