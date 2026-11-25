// safeStorage across two Electrons (2026-11-26, the client's move to the async API, src/main/index.ts `seal`/`unseal`):
// a token kept by the older Electron's sync API reads with the newer one's async API (an update), and a token the newer
// one sealed reads with the older one's sync API (a way back to it), in one data folder, as an update leaves it.
// Run at each Electron bump, from shell/, with the older binary kept aside before the bump:
//
//   node test/safe-storage.js <older electron binary> [newer electron binary; default: node_modules/electron's]
//
// A temp data folder; nothing of a person's is read. Under Electron this same file is the probe: <mode> <userData> <file>.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const SECRET = 'a-token-sealed-by-the-check-1234';

if (process.versions.electron) {
    const { app, safeStorage } = require('electron');
    const [mode, dir, file] = process.argv.slice(-3);
    app.setPath('userData', dir);
    app.whenReady().then(async () => {
        let ok = false;
        try {
            const sealed = () => Buffer.from(fs.readFileSync(file, 'utf8'), 'base64');
            if (mode === 'write-sync') { fs.writeFileSync(file, safeStorage.encryptString(SECRET).toString('base64')); ok = true; }
            if (mode === 'write-async') { fs.writeFileSync(file, (await safeStorage.encryptStringAsync(SECRET)).toString('base64')); ok = true; }
            if (mode === 'read-sync') ok = safeStorage.decryptString(sealed()) === SECRET;
            if (mode === 'read-async') ok = (await safeStorage.decryptStringAsync(sealed())).result === SECRET;
        } catch (e) { console.log(String((e && e.message) || e)); }
        console.log(`${ok ? 'PROBE-OK' : 'PROBE-FAIL'} ${process.versions.electron}`);
        app.quit(); // never app.exit(): Chromium writes the key into Local State on the way out (a first probe lost it)
    });
} else {
    const older = process.argv[2];
    const newer = process.argv[3] || require('electron');
    if (!older) { console.error('usage: node test/safe-storage.js <older electron binary> [newer electron binary]'); process.exit(2); }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-safe-storage-'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const step = (bin, mode, file) => {
        const r = spawnSync(bin, [__filename, mode, path.join(dir, 'userData'), path.join(dir, file)], { env, encoding: 'utf8', timeout: 60000 });
        const line = (r.stdout || '').split('\n').find((l) => l.startsWith('PROBE-')) || `no answer (${r.error ? r.error.message : `exit ${r.status}`})`;
        return { ok: line.startsWith('PROBE-OK'), line: `${mode} → ${line}` };
    };
    const checks = [
        ['a token kept by the older Electron (sync) reads with the newer one (async)', [[older, 'write-sync', 'old.txt'], [newer, 'read-async', 'old.txt']]],
        ['a token the newer Electron sealed (async) reads with the older one (sync): the way back', [[newer, 'write-async', 'new.txt'], [older, 'read-sync', 'new.txt']]],
    ];
    let failed = 0;
    for (const [name, steps] of checks) {
        const done = [];
        for (const [bin, mode, file] of steps) { done.push(step(bin, mode, file)); if (!done[done.length - 1].ok) break; }
        const ok = done.length === steps.length && done.every((d) => d.ok);
        if (!ok) failed++;
        console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}  (${done.map((d) => d.line).join('; ')})`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(failed ? `${failed} failed` : `${checks.length} passed`);
    process.exit(failed ? 1 : 0);
}
