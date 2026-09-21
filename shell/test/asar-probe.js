#!/usr/bin/env node
'use strict';
// Does a renderer inside a packed app.asar still run ES modules — static import, DYNAMIC import(),
// and a CSS @import — under the shell's exact renderer CSP?
//
// The whole LOL Chat loader (plan §3.1) rests on the answer: a "no" means main.mjs must fall back
// to generated static imports. The verdict was taken by hand at the P0 kickoff (2026-09-15) and is
// recorded in DEVLOG + DISCUSS; this script is that probe, committed, so an Electron bump or a
// packaging change (asarUnpack, a new CSP) can be re-answered in 20 seconds instead of by shipping
// an installer:
//
//   node shell/test/asar-probe.js            # prints PROBE_RESULT {...}; exit 0 = the loader stands
//   node shell/test/asar-probe.js --keep     # leave the packed fixture on disk and say where
//
// It packs a ~10-file fixture with the already-vendored @electron/asar, runs a HIDDEN Electron
// window on it with the same webPreferences as the harness (contextIsolation, no nodeIntegration)
// and a fresh mkdtemp userData, and quits. It never touches the shell's own app, the mock farm,
// or any port.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SHELL_DIR = path.resolve(__dirname, '..');
const KEEP = process.argv.includes('--keep');

/** The renderer CSP, read from renderer/index.html so the probe can never drift from the shipped one. */
function shippedCsp() {
    const html = fs.readFileSync(path.join(SHELL_DIR, 'renderer', 'index.html'), 'utf8');
    const m = /<meta http-equiv="Content-Security-Policy"\s*content="([^"]+)"/i.exec(html);
    if (!m) throw new Error('could not read the CSP out of renderer/index.html');
    return m[1].replace(/\s+/g, ' ').trim();
}

const FILES = (csp) => ({
    'package.json': JSON.stringify({ name: 'asar-probe', version: '0.0.0', main: 'main.cjs' }, null, 2),

    'main.cjs': [
        "'use strict';",
        "const { app, BrowserWindow } = require('electron');",
        "const path = require('path');",
        "app.on('window-all-closed', () => app.quit());",
        'app.whenReady().then(() => {',
        '  const win = new BrowserWindow({ show: false, width: 800, height: 600,',
        '    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false } });',
        "  let done = false;",
        // A listener with >1 declared parameter opts into the deprecated (event, level, message)
        // signature and prints a warning, so read the arguments instead.
        "  win.webContents.on('console-message', (...a) => {",
        '    const message = a[0] && typeof a[0].message === "string" ? a[0].message : a[2];',
        "    if (done || !String(message).startsWith('PROBE_RESULT')) return;",
        '    done = true;',
        '    process.stdout.write(String(message) + "\\n");',
        '    setTimeout(() => app.exit(0), 50);',
        '  });',
        "  win.loadFile(path.join(__dirname, 'index.html'));",
        '  setTimeout(() => { if (!done) { process.stdout.write("PROBE_TIMEOUT\\n"); app.exit(3); } }, 20000);',
        '});',
    ].join('\n'),

    'index.html': [
        '<!DOCTYPE html>',
        '<html lang="en"><head><meta charset="utf-8" />',
        `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        '<link rel="stylesheet" href="style.css" />',
        '<title>asar probe</title></head>',
        '<body><p id="mark">probe</p>',
        '<script src="classic.js"></script>',
        '<script type="module" src="entry.mjs"></script>',
        '</body></html>',
    ].join('\n'),

    'classic.js': 'window.classicRan = true;',

    'style.css': "@import './sub/imported.css';\nbody { margin: 0; }",
    'sub/imported.css': '#mark { color: rgb(1, 2, 3); }',

    'sub/dep.mjs': 'export const dep = "static-ok";',
    'sub/dyn.mjs': 'export const dyn = "dyn-ok";',
    // sub/nope.mjs is deliberately absent: the loader's failure path.

    'entry.mjs': [
        "import { dep } from './sub/dep.mjs';",
        'const out = {',
        '  classicRan: window.classicRan === true,',
        '  moduleRan: true,',
        "  staticImport: dep === 'static-ok',",
        '  dynamic: [],',
        '  cssImportApplied: false,',
        '  ua: navigator.userAgent.replace(/^.*(Electron\\/[\\d.]+).*$/, "$1"),',
        '};',
        'try {',
        "  const m = await import('./sub/dyn.mjs');",
        '  out.dynamic.push({ ok: true, value: m.dyn });',
        '} catch (err) {',
        '  out.dynamic.push({ ok: false, error: String(err && err.message) });',
        '}',
        'try {',
        "  await import('./sub/nope.mjs');",
        "  out.dynamic.push({ ok: true, missing: 'IMPORTED A FILE THAT IS NOT THERE' });",
        '} catch (err) {',
        '  out.dynamic.push({ ok: false, missing: String(err && err.message) });',
        '}',
        "out.cssImportApplied = getComputedStyle(document.getElementById('mark')).color === 'rgb(1, 2, 3)';",
        "console.log('PROBE_RESULT ' + JSON.stringify(out));",
    ].join('\n'),
});

async function main() {
    const asar = require(path.join(SHELL_DIR, 'node_modules', '@electron', 'asar'));
    const electronBin = require(path.join(SHELL_DIR, 'node_modules', 'electron'));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-asar-probe-'));
    const src = path.join(tmp, 'app');
    const packed = path.join(tmp, 'app.asar');
    const userData = path.join(tmp, 'userData');
    const csp = shippedCsp();
    for (const [rel, text] of Object.entries(FILES(csp))) {
        const file = path.join(src, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    }
    await asar.createPackage(src, packed);
    fs.rmSync(src, { recursive: true, force: true });     // ONLY the .asar is left: no unpacked copy
    console.log(`[asar-probe] packed ${packed} (CSP from renderer/index.html)`);

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;                     // else electron runs as plain node
    const child = spawn(electronBin, [packed, `--user-data-dir=${userData}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => {
        const s = String(d);
        if (/DevTools listening|Autofill|GPU stall|dbus|libva|Fontconfig|gpu_process/i.test(s)) return;
        process.stderr.write(`[electron!] ${s}`);
    });
    const code = await new Promise((resolve) => {
        const timer = setTimeout(() => { try { child.kill(); } catch { /* gone */ } resolve(4); }, 60000);
        child.on('exit', (c) => { clearTimeout(timer); resolve(c === null ? 1 : c); });
    });

    const line = out.split('\n').find((l) => l.startsWith('PROBE_RESULT'));
    if (!line) {
        console.error(`[asar-probe] no PROBE_RESULT (exit ${code})\n${out}`);
        if (!KEEP) fs.rmSync(tmp, { recursive: true, force: true });
        process.exit(2);
    }
    console.log(line);

    const r = JSON.parse(line.slice('PROBE_RESULT'.length));
    const dynOk = r.dynamic[0] && r.dynamic[0].ok === true;
    const missingRejected = r.dynamic[1] && r.dynamic[1].ok === false && /dynamically imported module|not found|ERR_/i.test(String(r.dynamic[1].missing));
    const verdict = r.classicRan && r.moduleRan && r.staticImport && dynOk && missingRejected && r.cssImportApplied;
    console.log(verdict
        ? '[asar-probe] OK — dynamic import() works inside app.asar: the §3.1 MODULES loader stands.'
        : '[asar-probe] FAILED — §3.1 must fall back to generated static imports. See the JSON above.');
    if (KEEP) console.log(`[asar-probe] --keep: fixture left at ${tmp}`);
    else fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(verdict ? 0 : 1);
}

main().catch((err) => { console.error('[asar-probe]', err); process.exit(2); });
