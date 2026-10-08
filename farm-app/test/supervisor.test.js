// The Farm app's supervisor and its stops, against the COMPILED output (build/main/*.js, `npm run build` first), with
// stubs: no process is started or killed, no port is touched (docs/VLLM_MANAGED_PLAN.md §3.12, §3.13, §11.1-19).
//   - stop() runs `lol down` before the tree-kill (it stops the vLLM the farm runs);
//   - stop({keepEngine}) (the share toggle) runs no `lol down` and kills only `lol up`'s own pid;
//   - a crash restart reaps the dead run's processes before the new `lol up`;
//   - reapStaleFarm kills what the runtime file records and never runs `lol down` (vLLM is not a pid there);
//   - the Linux autostart entry quotes the AppImage's path.
//
//   cd farm-app && npm run build && node test/supervisor.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const childProcess = require('child_process');

const BUILD = path.join(__dirname, '..', 'build', 'main');
const calls = [];
const stub = (name, exports) => {
    const f = name === 'electron' ? require.resolve('electron', { paths: [BUILD] }) : path.join(BUILD, `${name}.js`);
    require.cache[f] = { id: f, filename: f, loaded: true, exports };
};
const fresh = (name) => { const f = path.join(BUILD, `${name}.js`); delete require.cache[f]; return require(f); };

const farmDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-farmapp-test-'));
stub('electron', { app: { getVersion: () => '0.0.0-test', getPath: () => farmDir } });
stub('paths', {
    farmRoot: () => farmDir, lolEntry: () => path.join(farmDir, 'bin', 'lol.js'),
    bundledPython: () => 'python', pythonDir: () => farmDir, ollamaDir: () => farmDir,
});
stub('farmLog', { appendFarmLog: () => {} });
stub('util', {
    killTree: async (pid) => { calls.push(['killTree', pid]); },
    killOne: async (pid) => { calls.push(['killOne', pid]); },
    waitForHttp: async () => true,
    httpGetJson: async () => ({ ips: [], proxyPort: 4000 }),
});
let lolDownGate = null;   // a promise `lol down` waits for (a slow vLLM stop), when a test sets one
stub('farmProcess', {
    reapStaleFarm: async () => { calls.push(['reap']); },
    lolDown: async (env) => { calls.push(['lolDown', env.ELECTRON_RUN_AS_NODE]); if (lolDownGate) await lolDownGate; },
    runtimeFile: () => path.join(farmDir, '.lol-runtime.json'),
});
// `lol up` itself: a fake child.
let nextPid = 1000; const spawned = [];
childProcess.spawn = (cmd, args) => {
    const c = new EventEmitter();
    c.pid = ++nextPid; c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    spawned.push(c); calls.push(['spawn', c.pid, args.slice(-2).join(' ')]);
    return c;
};

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const settle = () => new Promise((r) => setTimeout(r, 20));

test('stop() (Quit, the Stop button) runs `lol down` first, then the tree-kill as a backstop, then the reap', async () => {
    const { FarmSupervisor } = fresh('farmSupervisor');
    const sup = new FarmSupervisor();
    await sup.start();
    assert.equal(sup.getState().status, 'ready');
    const pid = spawned[spawned.length - 1].pid;
    calls.length = 0;
    await sup.stop();
    assert.deepEqual(calls, [['lolDown', '1'], ['killTree', pid], ['reap']]);
    assert.equal(sup.getState().status, 'stopped');
    // No farm ran and none is recorded: nothing to stop, so no `lol down` (it could boot WSL for nothing).
    calls.length = 0;
    await sup.stop();
    assert.deepEqual(calls, [['reap']]);
    fs.writeFileSync(path.join(farmDir, '.lol-runtime.json'), '{}');
    calls.length = 0;
    await sup.stop();
    assert.deepEqual(calls, [['lolDown', '1'], ['reap']], 'a run recorded by a farm this app no longer holds: stopped too');
    fs.unlinkSync(path.join(farmDir, '.lol-runtime.json'));
});

test('stop({keepEngine}) (the share toggle) runs no `lol down` and kills only `lol up`, never its tree', async () => {
    const { FarmSupervisor } = fresh('farmSupervisor');
    const sup = new FarmSupervisor();
    await sup.start();
    const pid = spawned[spawned.length - 1].pid;
    calls.length = 0;
    await sup.stop({ keepState: true, keepEngine: true });
    assert.deepEqual(calls, [['killOne', pid], ['reap']]);
    assert.equal(sup.getState().status, 'ready', 'keepState: the screen does not flash "stopped"');
});

test('a crash of `lol up` is restarted only after the dead run\'s processes are reaped', async () => {
    const { FarmSupervisor } = fresh('farmSupervisor');
    const sup = new FarmSupervisor();
    await sup.start();
    const dead = spawned[spawned.length - 1];
    calls.length = 0;
    dead.emit('exit', 1);
    await settle();
    assert.deepEqual(calls.map((c) => c[0]), ['reap', 'spawn'], JSON.stringify(calls));
    assert.ok(!calls.some((c) => c[0] === 'lolDown' || c[0] === 'killTree'), 'a crash stops nothing: the next `lol up` keeps vLLM');
    await settle();
    assert.equal(sup.getState().status, 'ready');
    // A stop() while the reap runs: no restart after it.
    const again = spawned[spawned.length - 1];
    calls.length = 0;
    again.emit('exit', 1);
    await sup.stop({ keepState: true });
    await settle();
    assert.ok(!calls.some((c) => c[0] === 'spawn'), JSON.stringify(calls));
});

test('Quit after the farm kept crashing still runs `lol down`: a `lol up` that kept vLLM may have left no runtime file', async () => {
    const { FarmSupervisor } = fresh('farmSupervisor');
    const sup = new FarmSupervisor();
    await sup.start();
    sup.crashRestarts = 5;   // the restarts used up (each reaped the dead run's runtime file)
    spawned[spawned.length - 1].emit('exit', 1);
    await settle();
    assert.equal(sup.getState().status, 'error', 'it gave up after 5 restarts');
    assert.ok(!fs.existsSync(path.join(farmDir, '.lol-runtime.json')), 'no runtime file, no child');
    calls.length = 0;
    await sup.stop();
    assert.deepEqual(calls, [['lolDown', '1'], ['reap']], JSON.stringify(calls));
});

test('a stop says "stopping" while `lol down` runs, and a Start meanwhile waits for it to end', async () => {
    const { FarmSupervisor } = fresh('farmSupervisor');
    const sup = new FarmSupervisor();
    await sup.start();
    let release; lolDownGate = new Promise((r) => { release = r; });
    const states = []; sup.on('state', (s) => states.push(s.status));
    calls.length = 0;
    const stopped = sup.stop();
    await settle();
    assert.equal(sup.getState().status, 'stopping');
    assert.match(sup.getState().message, /^Stopping the farm… With vLLM this can take a minute, while it frees the GPU\.$/);
    const started = sup.start();
    await settle();
    assert.ok(!calls.some((c) => c[0] === 'spawn'), 'no `lol up` while `lol down` stops vLLM: it would keep the vLLM being stopped');
    lolDownGate = null; release();
    await stopped; await started;
    assert.deepEqual(calls.map((c) => c[0]), ['lolDown', 'killTree', 'reap', 'spawn'], JSON.stringify(calls));
    assert.deepEqual(states.slice(0, 2), ['stopping', 'stopped']);
    assert.equal(sup.getState().status, 'ready');
    calls.length = 0;
    await sup.stop({ keepState: true, keepEngine: true });
    assert.ok(!states.slice(-1).includes('stopping') && sup.getState().status === 'ready', 'the share toggle\'s restart shows no stop');
});

test('the share toggle in index.ts keeps the engine; Quit and Stop do not; Quit keeps the window up while the farm stops', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
    assert.ok(/set-share-network[\s\S]*?supervisor\.stop\(\{ keepState: true, keepEngine: true \}\)/.test(src));
    assert.ok(/before-quit[\s\S]*?supervisor\.stop\(\)\.finally\(\(\) => app\.exit\(0\)\)/.test(src) && /farm-stop', async \(\) => \{ await supervisor\.stop\(\);/.test(src));
    assert.ok(/win\.on\('close', \(e\) => \{ if \(process\.platform !== 'darwin'\) \{ e\.preventDefault\(\); app\.quit\(\); \} \}\)/.test(src), 'closing the window goes through Quit, the window kept');
    assert.ok(/win\.on\('closed', \(\) => \{ win = null; \}\)/.test(src) && /second-instance', \(\) => \{ if \(win && !win\.isDestroyed\(\)\)/.test(src), 'a second launch during a stop never touches a destroyed window');
    const ui = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
    assert.ok(/stopping: 'Stopping…'/.test(ui) && /toggle\.disabled = transient\(s\.status\)/.test(ui) && /status === 'stopping'/.test(ui), 'the window says it and Start/Stop waits');
});

test('reapStaleFarm kills what the runtime file records and never runs `lol down` (vLLM is not a pid there)', async () => {
    delete require.cache[path.join(BUILD, 'farmProcess.js')];
    const realExecFile = childProcess.execFile;
    let execs = 0;
    childProcess.execFile = (...a) => { execs++; return realExecFile(...a); };
    try {
        const { reapStaleFarm } = require(path.join(BUILD, 'farmProcess.js'));
        const me = process.pid;   // alive, and only recorded: the util stub kills nothing
        const rt = path.join(farmDir, '.lol-runtime.json');
        fs.writeFileSync(rt, JSON.stringify({
            litellmPid: me, searxngPid: me, kokoroPid: null, extractPid: me, classifyPid: me, sttPid: me, busPid: me, embedPid: me, llamacppPid: me, ollamaPids: [me],
            vllm: { platform: 'win32', distro: 'Ubuntu', root: '/home/me/lol-vllm', port: 8100 },
        }));
        calls.length = 0;
        await reapStaleFarm();
        assert.equal(calls.filter((c) => c[0] === 'killTree').length, 9, 'LiteLLM, the plugins (document search\'s llama-server too), llama-server, Ollama');
        assert.ok(!calls.some((c) => c[0] === 'lolDown' || c[0] === 'spawn') && execs === 0, 'no `lol down`, nothing spawned');
        assert.ok(!fs.existsSync(rt), 'the stale record is dropped');
    } finally { childProcess.execFile = realExecFile; }
});

test('the Linux autostart entry runs the AppImage, its path quoted as the Desktop Entry spec asks', () => {
    const { autostartEntry } = fresh('util');
    assert.equal(autostartEntry('/home/me/Apps/LlmOnLan Farm-0.0.43-arm64.AppImage'),
        '[Desktop Entry]\nType=Application\nName=LlmOnLan Farm\nExec="/home/me/Apps/LlmOnLan Farm-0.0.43-arm64.AppImage"\nX-GNOME-Autostart-enabled=true\n');
    assert.equal(/^Exec=(.*)$/m.exec(autostartEntry('/a/50%$x"y`z\\w.AppImage'))[1], '"/a/50%%\\$x\\"y\\`z\\\\\\\\w.AppImage"');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
    assert.ok(/'autostart', 'llmonlan-farm\.desktop'/.test(src) && /process\.env\.APPIMAGE/.test(src));
});

(async () => {
    try {
        for (const { name, fn } of tests) {
            try { await fn(); console.log(`  ok  ${name}`); passed++; }
            catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
        }
    } finally { fs.rmSync(farmDir, { recursive: true, force: true }); }
    console.log(`\n${passed} passed`);
})();
