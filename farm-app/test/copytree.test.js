// The farm code refresh's copy (src/main/copyTree.ts), against the COMPILED output, run under ELECTRON'S own Node:
// Electron 42's fs.cpSync deletes a file before writing it, so a file something holds open (the bash running
// vllm/serve.sh through WSL) was left "delete pending", the copy stopped and every later file was skipped
// (farm-v0.0.43 on the PRO 6000, 2026-10-08). The system's Node does not do that, so this test re-runs itself
// under Electron when started with plain node:
//
//   cd farm-app && npm run build && node test/copytree.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.versions.electron) {
    const electron = require('electron');   // in plain node: the path to Electron's binary
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    const r = require('child_process').spawnSync(electron, [__filename], { stdio: 'inherit', env });
    process.exit(r.status === null ? 1 : r.status);
}

const { copyTree } = require(path.join(__dirname, '..', 'build', 'main', 'copyTree.js'));
let passed = 0;
const test = (name, fn) => { fn(); console.log(`  ok  ${name}`); passed++; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lol-copytree-'));
const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const NEW = ['vllm/install.sh', 'vllm/relay.py', 'vllm/serve.sh', 'vllm/status.sh', 'vllm/stop.sh', 'src/up.js'];
const OLD = ['vllm/install.sh', 'vllm/relay.py', 'vllm/serve.sh', 'vllm/stop.sh', 'src/up.js'];
function tree() {
    const src = tmp(), dst = tmp();
    for (const f of NEW) write(src, f, `new ${f}\n`);
    for (const f of OLD) write(dst, f, `old ${f}\n`);
    return { src, dst };
}

console.log(`copyTree under Electron ${process.versions.electron} (Node ${process.versions.node})`);

test('a file held open is replaced, the holder keeps its old copy, and the files after it are copied too', () => {
    const { src, dst } = tree();
    const held = fs.openSync(path.join(dst, 'vllm/serve.sh'), 'r');   // the bash running serve.sh
    try {
        assert.deepEqual(copyTree(src, dst), []);
        for (const f of NEW) assert.equal(read(dst, f), `new ${f}\n`, f);
        const buf = Buffer.alloc(32);
        assert.equal(buf.toString('utf8', 0, fs.readSync(held, buf, 0, 32, 0)), 'old vllm/serve.sh\n', 'the holder still reads the old script');
    } finally { fs.closeSync(held); }
    // What it moved aside goes at the next refresh, once nothing holds it.
    assert.ok(fs.readdirSync(path.join(dst, '.replaced')).length > 0);
    copyTree(src, dst);
    assert.deepEqual(fs.readdirSync(path.join(dst, '.replaced')), []);
});

test('a name nothing can take ("delete pending", as on the PRO 6000) is reported, and every other file is still copied', () => {
    const { src, dst } = tree();
    const serve = path.join(dst, 'vllm/serve.sh');
    const held = fs.openSync(serve, 'r');
    // The state the PRO 6000 was left in, made the way it was made: Electron's own cpSync over a held file (node's
    // unlinkSync frees the name at once on Windows, so it cannot make it).
    // (with a filter, as the Farm app called it: that is the code path that deletes first)
    try { fs.cpSync(src, dst, { recursive: true, force: true, verbatimSymlinks: true, filter: () => true }); } catch { /* the bug */ }
    let pending = false;   // lstat still answers for a delete-pending file; opening it is refused
    try { fs.closeSync(fs.openSync(serve, 'r')); } catch (e) { pending = e.code === 'EPERM'; }
    try {
        if (!pending) { console.log('       (this Electron no longer leaves a file "delete pending": nothing to reproduce)'); return; }
        const failed = copyTree(src, dst);
        assert.equal(failed.length, 1);
        assert.match(failed[0], /^vllm\/serve\.sh \(/);
        for (const f of NEW.filter((f) => f !== 'vllm/serve.sh')) assert.equal(read(dst, f), `new ${f}\n`, f);
    } finally { fs.closeSync(held); }
    assert.deepEqual(copyTree(src, dst), [], 'released: the next refresh completes');
    assert.equal(read(dst, 'vllm/serve.sh'), 'new vllm/serve.sh\n');
});

test('an unchanged file is left alone, and the filter keeps what it must', () => {
    const { src, dst } = tree();
    write(src, 'lol.config.json', '{"from":"the bundle"}');
    write(dst, 'lol.config.json', '{"the":"operator"}');
    copyTree(src, dst, (rel) => rel !== 'lol.config.json');
    const before = fs.statSync(path.join(dst, 'vllm/stop.sh')).mtimeMs;
    assert.deepEqual(copyTree(src, dst, (rel) => rel !== 'lol.config.json'), []);
    assert.equal(fs.statSync(path.join(dst, 'vllm/stop.sh')).mtimeMs, before, 'not rewritten');
    assert.deepEqual(fs.readdirSync(path.join(dst, '.replaced')), [], 'nothing moved aside');
    assert.equal(read(dst, 'lol.config.json'), '{"the":"operator"}');
});

console.log(`${passed} passed`);
