'use strict';
// Driver for the chat-only Electron harness (plan §2.2, §2.6 A). Works from any cwd.
//
//   node shell/test/chat-harness/run.js                  # every scenario except the perf group
//   node shell/test/chat-harness/run.js --phase h0       # scenarios whose name starts with "h0-"
//   node shell/test/chat-harness/run.js --only h0-ports,h0-loader
//   node shell/test/chat-harness/run.js --phase perf     # perf group: 3 runs each, median judged
//   node shell/test/chat-harness/run.js --strict         # no fakes: a failed import fails the run
//   node shell/test/chat-harness/run.js --show           # visible via showInactive() (no focus steal)
//   node shell/test/chat-harness/run.js --keep           # leave mock + electron up
//   node shell/test/chat-harness/run.js --slot 2         # every port +20*2 (parallel builders)
//
// THIS BOX RUNS A LIVE FARM AND THE OWNER'S REAL CLIENT:
//   - every port is refused if it computes to one of 4000, 4001, 41997, 41998, 8081, 8888, 8890, 11434;
//   - a busy port aborts the run — the driver NEVER kills a process it did not start;
//   - the mock is spawned with LOL_MOCK_BEACON_OK deleted from the env, so it cannot beacon and the
//     owner's client can never discover it;
//   - electron runs chat-harness/main.cjs against a fresh mkdtemp userData, never `electron .`.
//
// Extra flags beyond §2.2 (harness plumbing, not part of the scenario contract):
//   --mock <path>   run a different mock entry point (default ../mock-farm.js)
//   --no-mock       do not spawn a mock at all; scenarios declaring needsMock:true are skipped
//   --list          print the scenario names that would run, then exit
//   --shots <dir>   where h.screenshot() writes (default chat-harness/generated/shots, gitignored;
//                   it survives teardown, unlike the mkdtemp userData)

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');

const HARNESS_DIR = __dirname;
const TEST_DIR = path.join(HARNESS_DIR, '..');
const SHELL_DIR = path.join(TEST_DIR, '..');
const SCENARIO_DIR = path.join(HARNESS_DIR, 'scenarios');

const BASE_PORTS = { cdp: 9333, proxy: 4009, keyed: 4010, services: 4011, self: 41987 };
const SLOT_STRIDE = 20;
const FORBIDDEN_PORTS = new Set([4000, 4001, 41997, 41998, 8081, 8888, 8890, 11434]);
const MOCK_KEY = 'harness-pw';

const CHAT_DIR = path.join(SHELL_DIR, 'renderer', 'chat');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `file:///…/renderer/chat/net/farm.mjs` → `net/farm.mjs` (for the run's "not landed yet" note). */
function moduleName(url) {
    try { return path.relative(CHAT_DIR, fileURLToPath(String(url))).split(path.sep).join('/'); }
    catch { return String(url); }
}

/**
 * True for a network error about a `.mjs` under shell/renderer/chat/ that is NOT on disk — i.e. a
 * loader-table row whose unit has not landed yet (the loader catches it and uses the fake). See the
 * Log.entryAdded handler for why this exemption exists and why it is this narrow.
 */
function isNotLandedModule(entry) {
    if (entry.source !== 'network') return false;
    const url = String(entry.url || '');
    if (!url.startsWith('file://') || !/\.mjs(\?|$)/.test(url)) return false;
    let file;
    try { file = fileURLToPath(url.split('?')[0]); } catch { return false; }
    const rel = path.relative(CHAT_DIR, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    return !fs.existsSync(file);
}

// ---- args ------------------------------------------------------------------------------------

function parseArgs(argv) {
    const a = {
        phase: null, only: null, strict: false, show: false, keep: false, slot: 0,
        list: false, mock: path.join(TEST_DIR, 'mock-farm.js'), noMock: false,
        // Screenshots must OUTLIVE the run (the landing looks at them), so they go next to the
        // harness in generated/ (gitignored), not into the mkdtemp userData that teardown deletes.
        shots: path.join(HARNESS_DIR, 'generated', 'shots'),
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) throw new Error(`${arg} needs a value`);
            i++;
            return v;
        };
        if (arg === '--phase') a.phase = value();
        else if (arg === '--only') a.only = value().split(',').map((s) => s.trim()).filter(Boolean);
        else if (arg === '--slot') a.slot = Number(value());
        else if (arg === '--mock') a.mock = path.resolve(value());
        else if (arg === '--shots') a.shots = path.resolve(value());
        else if (arg === '--strict') a.strict = true;
        else if (arg === '--show') a.show = true;
        else if (arg === '--keep') a.keep = true;
        else if (arg === '--no-mock') a.noMock = true;
        else if (arg === '--list') a.list = true;
        else throw new Error(`unknown argument: ${arg}`);
    }
    // The cap is generous on purpose: the forbidden-port guard below is only REACHABLE at a high
    // slot (e.g. slot 244 computes keyed=8890), and a gate nobody can trigger is a gate nobody can
    // test. Builders use single-digit slots.
    if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot > 300) throw new Error(`--slot must be an integer 0..300 (got ${a.slot})`);
    return a;
}

/** Slot n offsets EVERY port by 20n (plan §2.6 A). */
function portsForSlot(slot) {
    const ports = {};
    for (const [k, v] of Object.entries(BASE_PORTS)) ports[k] = v + SLOT_STRIDE * slot;
    const clash = Object.entries(ports).filter(([, p]) => FORBIDDEN_PORTS.has(p));
    if (clash.length) {
        throw new Error(
            `refusing to run: slot ${slot} computes ${clash.map(([k, p]) => `${k}=${p}`).join(', ')}, `
            + `which is in the live-farm port set {${[...FORBIDDEN_PORTS].join(', ')}}`,
        );
    }
    return ports;
}

/** Connect-test: resolves true when something is ALREADY listening on the port. */
function portBusy(port) {
    return new Promise((resolve) => {
        const s = net.connect({ host: '127.0.0.1', port });
        const done = (busy) => { s.destroy(); resolve(busy); };
        s.once('connect', () => done(true));
        s.once('error', () => done(false));
        s.setTimeout(1200, () => done(false));
    });
}

// ---- scenarios -------------------------------------------------------------------------------

async function loadScenarios() {
    let files = [];
    try {
        files = fs.readdirSync(SCENARIO_DIR).filter((f) => f.endsWith('.mjs')).sort();
    } catch { files = []; }
    const all = [];
    for (const f of files) {
        const mod = await import(pathToFileURL(path.join(SCENARIO_DIR, f)).href);
        const list = mod.default;
        if (!Array.isArray(list)) throw new Error(`${f}: default export must be an array of scenarios`);
        for (const s of list) {
            if (!s || typeof s.name !== 'string' || typeof s.run !== 'function') {
                throw new Error(`${f}: every scenario needs {name, run(h)}`);
            }
            all.push({ file: f, ...s });
        }
    }
    return all;
}

function selectScenarios(all, args) {
    let list = all;
    if (args.only) list = list.filter((s) => args.only.includes(s.name));
    else if (args.phase === 'perf') list = list.filter((s) => s.perf === true);
    else if (args.phase) list = list.filter((s) => s.name.startsWith(`${args.phase}-`) && s.perf !== true);
    else list = list.filter((s) => s.perf !== true);
    return list;
}

const median = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// ---- main ------------------------------------------------------------------------------------

async function main() {
    let args, ports;
    try {
        args = parseArgs(process.argv.slice(2));
        ports = portsForSlot(args.slot);
    } catch (e) {
        console.error(`[run] ABORT: ${e && e.message ? e.message : e}`);
        return 1;
    }
    const all = await loadScenarios();
    const chosen = selectScenarios(all, args);

    if (args.list) {
        for (const s of chosen) console.log(`${s.name}${s.perf ? ' (perf)' : ''}   [${s.file}]`);
        console.log(`${chosen.length} of ${all.length} scenarios`);
        return 0;
    }
    if (!chosen.length) {
        console.error(`no scenarios selected (phase=${args.phase} only=${args.only ? args.only.join(',') : '-'})`);
        return 1;
    }

    console.log(`[run] slot ${args.slot} → ports ${JSON.stringify(ports)}`);

    // 1. preflight — never kills anything
    for (const [role, port] of Object.entries(ports)) {
        if (args.noMock && role !== 'cdp') continue;
        if (await portBusy(port)) {
            console.error(
                `[run] ABORT: ${role} port ${port} is already in use (slot ${args.slot}).\n`
                + '       Nothing was started and NOTHING WAS KILLED. Use a different --slot, or find the\n'
                + '       owner of that port and stop it yourself.',
            );
            return 1;
        }
    }

    // 2. bridge extraction
    const { write: writeBridge } = require('./extract-app-bridge.js');
    const bridgeFile = writeBridge(path.join(HARNESS_DIR, 'generated', 'app-bridge.js'));
    console.log(`[run] extracted app.js bridge → ${path.relative(SHELL_DIR, bridgeFile)}`);

    const children = [];
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lolchat-harness-'));
    let exitCode = 0;
    let cdp = null;

    const teardown = async () => {
        if (args.keep) {
            console.log(`[run] --keep: leaving electron + mock up. CDP on 127.0.0.1:${ports.cdp}, userData ${tmp}`);
            return;
        }
        if (cdp) { try { cdp.close(); } catch { /* already closed */ } }
        for (const c of children) {
            try { c.kill(); } catch { /* already gone */ }
        }
        await sleep(300);
        for (const c of children) {
            if (c.exitCode === null && c.signalCode === null) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
        }
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows file locks */ }
    };

    try {
        // 3. mock farm — never with a beacon
        let hasMock = false;
        // S0 kickoff: `needsProjects:'real'` scenarios need the compiled main output. Missing =>
        // those scenarios are SKIPPED (a renderer-only builder still gets a green run); the
        // landing runs with the build present and 0 skipped is a landing gate.
        const hasProjectsBuild = fs.existsSync(path.join(SHELL_DIR, 'build', 'main', 'projects.js'));
        if (!hasProjectsBuild) console.log("[run] no shell/build/main/projects.js: needsProjects:'real' scenarios will be skipped");
        // K7 (addendum KG): the same rule for the Computer's debug-log writer.
        const hasDebugLogBuild = fs.existsSync(path.join(SHELL_DIR, 'build', 'main', 'debugLog.js'));
        if (!hasDebugLogBuild) console.log("[run] no shell/build/main/debugLog.js: needsDebugLog:'real' scenarios will be skipped");
        if (!args.noMock) {
            if (!fs.existsSync(args.mock)) throw new Error(`mock farm not found: ${args.mock}`);
            const env = { ...process.env };
            delete env.LOL_MOCK_BEACON_OK;
            // The slot is passed through; the mock applies the same +20n to its own defaults and
            // refuses the forbidden set itself.
            const mockArgs = [args.mock, '--slot', String(args.slot), '--key', MOCK_KEY, '--no-beacon'];
            const mock = spawn(process.execPath, mockArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
            children.push(mock);
            mock.stdout.on('data', (d) => process.stdout.write(`[mock] ${d}`));
            mock.stderr.on('data', (d) => process.stderr.write(`[mock!] ${d}`));
            mock.on('exit', (code) => { if (code !== null && code !== 0) console.error(`[mock] exited with ${code}`); });

            const { req } = require('./helpers.js');
            const deadline = Date.now() + 20000;
            for (;;) {
                try {
                    const r = await req('GET', `http://127.0.0.1:${ports.services}/mock/health`);
                    const body = r.body || {};
                    if (r.status === 200 && body.beacon === false) { hasMock = true; break; }
                    if (r.status === 200 && body.beacon !== false) {
                        throw new Error(`the mock reports beacon:${body.beacon} — refusing to run next to the owner's client`);
                    }
                } catch (e) {
                    if (/refusing to run/.test(e.message)) throw e;
                }
                if (Date.now() > deadline) {
                    throw new Error(
                        `the mock never answered GET http://127.0.0.1:${ports.services}/mock/health with beacon:false.\n`
                        + '       (If shell/test/mock-farm.js is still the legacy E2E mock, P0-U1 has not landed yet:\n'
                        + '        run with --no-mock to exercise the scenarios that do not need it.)',
                    );
                }
                await sleep(200);
            }
            console.log(`[run] mock farm up on ${ports.proxy}/${ports.keyed}/${ports.services}/${ports.self}, beacon:false`);
        } else {
            console.log('[run] --no-mock: scenarios that declare needsMock:true will be skipped');
        }

        // 4. electron
        const electronBin = require(path.join(SHELL_DIR, 'node_modules', 'electron'));
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;          // VS Code exports it; electron would run as plain node
        const initialQuery = [
            'farm=mock', 'refreshMs=4000', `proxy=${ports.proxy}`, `keyed=${ports.keyed}`,
            `self=${ports.self}`, `key=${MOCK_KEY}`,
            `flags=${encodeURIComponent(JSON.stringify(args.strict ? { allowFakes: false } : { allowFakes: true }))}`,
        ].join('&');
        const electronArgs = [
            path.join(HARNESS_DIR, 'main.cjs'),
            `--user-data-dir=${tmp}`,
            `--remote-debugging-port=${ports.cdp}`,
            `--query=${initialQuery}`,
        ];
        if (args.show) electronArgs.push('--show');
        const electron = spawn(electronBin, electronArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
        children.push(electron);
        electron.stdout.on('data', (d) => process.stdout.write(`[electron] ${d}`));
        electron.stderr.on('data', (d) => {
            const s = String(d);
            if (/DevTools listening|Autofill|GPU stall|dbus|libva|Fontconfig/i.test(s)) return;
            process.stderr.write(`[electron!] ${s}`);
        });

        // 5. cdp
        const { connect } = require('./cdp.js');
        cdp = await connect({ port: ports.cdp, match: /chat-harness[\\/]page\.html/, timeoutMs: 45000 });
        console.log(`[run] CDP attached: ${cdp.target.url.slice(0, 110)}`);

        // A show:false BrowserWindow has no on-screen surface, so Chromium produces no compositor
        // frames and requestAnimationFrame falls back to its ~1 Hz idle timer (measured at the P1
        // landing: h0-raf-runs flaked 3 runs in 4 at 1 rAF/s, and every rAF-driven render scenario
        // was measuring catch-up paints rather than frames). A CDP screencast gives the window a
        // consumer for its frames, which puts the compositor back on the display cadence: 61/s,
        // every run. It is kept deliberately tiny (64x64 jpeg q10) and every frame is acked, because
        // Chromium stops producing after a couple of unacked frames.
        try {
            cdp.on('Page.screencastFrame', (f) => { cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}); });
            await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 64, maxHeight: 64, everyNthFrame: 1 });
        } catch (err) {
            console.warn(`[run] frame pump unavailable (${err && err.message}); rAF may throttle to ~1 Hz`);
        }

        /** @type {string[]} */ const consoleErrors = [];
        /** @type {string[]} */ const notes = [];
        cdp.on('Runtime.consoleAPICalled', (p) => {
            if (p.type !== 'error' && p.type !== 'assert') return;
            consoleErrors.push((p.args || []).map((a) => a.description || a.value || a.type).join(' '));
        });
        cdp.on('Runtime.exceptionThrown', (p) => {
            const d = p.exceptionDetails || {};
            consoleErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text || 'uncaught exception');
        });
        /** @type {Set<string>} */ const notLanded = new Set();
        cdp.on('Log.entryAdded', (p) => {
            const e = p.entry || {};
            if (e.level !== 'error') return;
            // A loader row whose UNIT HAS NOT LANDED YET fetches a file that does not exist, and
            // Chromium logs that network 404 at level "error" even though main.mjs catches the
            // rejection and falls back to the fake. Without this exemption, adding the next phase's
            // loader rows at kickoff turns EVERY scenario red for every builder (measured at the P1
            // kickoff: 20/20 failed on 10 missing modules). The exemption is deliberately narrow and
            // self-closing: only a .mjs under shell/renderer/chat/ that IS NOT ON DISK. A file that
            // exists but throws, a missing CSS/asset, and anything outside the chat tree all still
            // fail the scenario — and --strict still fails on LolChat.failed regardless.
            if (isNotLandedModule(e)) { notLanded.add(moduleName(e.url)); return; }
            consoleErrors.push(`${e.source}: ${e.text}`);
        });

        const { createHelpers } = require('./helpers.js');
        const h = createHelpers({
            cdp, ports, tmpDir: tmp, harnessDir: HARNESS_DIR, strict: args.strict, show: args.show, hasMock,
            consoleErrors, notes, shotsDir: args.shots,
        });

        // 6. scenarios
        let failed = 0, skipped = 0;
        /** Every failure, repeated in the tail (S0 review, finding 7): a run that streams 118 JSON
         *  lines buries the one that went red, and a flake whose name scrolled away costs an hour. */
        /** @type {{scenario: string, error: string}[]} */ const failures = [];
        for (const s of chosen) {
            if (s.needsProjects === 'real' && !hasProjectsBuild) {
                skipped++;
                console.log(JSON.stringify({
                    scenario: s.name, ok: true, skipped: true,
                    error: 'needs the compiled projects API — run: npm --prefix shell run build',
                }));
                continue;
            }
            if (s.needsDebugLog === 'real' && !hasDebugLogBuild) {
                skipped++;
                console.log(JSON.stringify({
                    scenario: s.name, ok: true, skipped: true,
                    error: 'needs the compiled debug-log writer — run: npm --prefix shell run build',
                }));
                continue;
            }
            if (s.needsMock && !hasMock) {
                skipped++;
                console.log(JSON.stringify({ scenario: s.name, ok: true, skipped: true, error: 'needs the mock farm (--no-mock)' }));
                continue;
            }
            const started = Date.now();
            notes.length = 0;
            // The main-process logs accumulate for the whole electron process; mark where they
            // stand so h.downloads()/shellCalls()/windowOpens() report only THIS scenario's doing.
            h.markLogs();
            let ok = true, error = null, result = null;
            const runs = s.perf ? 3 : 1;
            /** @type {any[]} */ const metrics = [];
            try {
                for (let i = 0; i < runs; i++) {
                    // `boot` (C1 kickoff): the fresh() options this scenario wants for its own
                    // boot — e.g. {flags:{skipModules:['computer']}} for a scenario that is about
                    // the workbench itself rather than about the panels a phase ships.
                    if (!s.keepStorage) await h.fresh(s.boot || {});
                    else consoleErrors.length = 0;
                    const timeoutMs = s.timeoutMs || 60000;
                    let timer;
                    const guard = new Promise((_, reject) => {
                        timer = setTimeout(() => reject(new Error(`scenario timed out after ${timeoutMs} ms`)), timeoutMs);
                    });
                    try {
                        result = await Promise.race([Promise.resolve().then(() => s.run(h)), guard]);
                    } finally { clearTimeout(timer); }
                    if (result && typeof result === 'object') metrics.push(result);

                    const allow = (s.allowConsoleErrors || []).map((r) => (r instanceof RegExp ? r : new RegExp(r)));
                    const bad = consoleErrors.filter((e) => !allow.some((r) => r.test(e)));
                    if (bad.length) throw new Error(`page console errors: ${JSON.stringify(bad.slice(0, 3))}`);

                    // --strict (landings): a module that did not load is a failed run, not a fake.
                    if (args.strict && !s.allowFailedModules) {
                        const failedModules = await h.eval(() => Object.keys((window.LolChat && window.LolChat.failed) || {}));
                        if (failedModules.length) throw new Error(`--strict: modules failed to load: ${failedModules.join(', ')}`);
                    }
                }
                if (s.perf && typeof s.judge === 'function') {
                    const keys = [...new Set(metrics.flatMap((m) => Object.keys(m)))].filter((k) => metrics.every((m) => typeof m[k] === 'number'));
                    const med = {};
                    for (const k of keys) med[k] = median(metrics.map((m) => m[k]));
                    result = med;
                    await s.judge(med, h);
                }
            } catch (e) {
                ok = false;
                failed++;
                error = e && e.message ? e.message : String(e);
            }
            const line = { scenario: s.name, ok, ms: Date.now() - started };
            if (error) { line.error = error; failures.push({ scenario: s.name, error }); }
            if (notes.length) line.notes = notes.slice();
            if (s.perf && result) line.metrics = result;
            console.log(JSON.stringify(line));
        }

        if (notLanded.size) {
            console.log(`[run] loader rows not landed yet (fakes used, 404s ignored): ${[...notLanded].sort().join(', ')}`);
        }
        if (failures.length) {
            console.log(`[run] FAILED (${failures.length}):`);
            for (const f of failures) console.log('[run]   ' + f.scenario + ': ' + String(f.error).split(String.fromCharCode(10))[0].slice(0, 200));
        }
        console.log(`[run] ${chosen.length - failed - skipped} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}`);
        exitCode = failed ? 1 : 0;
    } catch (e) {
        console.error(`[run] ABORT: ${e && e.message ? e.message : e}`);
        exitCode = 1;
    } finally {
        await teardown();
    }
    return exitCode;
}

main().then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
