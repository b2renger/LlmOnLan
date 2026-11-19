// One rehearsal client (CLASS_REHEARSAL_PLAN step 1): the client's own compiled main code with no window: discovery
// (build/main/discovery.js), the farm choice (farmSelect.js chooseActive, farmContext, connectPlan) and the Open WebUI
// supervisor (sidecar.js), Electron stubbed. The wiring is index.ts's, mirrored (boot: wait up to 4.5 s for a farm, then
// start Open WebUI on it; each farms event: choose, and repoint when connectPlan says so): that part is not run, it is
// copied, and the report says so. Everything it touches is on 127.0.0.1: discovery listens on the rehearsal's own group
// and port (LOL_FED_GROUP, LOL_FED_PORT, set by run.js), sweeps nothing and has no peers.
// Prints one JSON line per event on stdout: {t, kind, ...}. Env: REH_USERDATA, REH_DATADIR, REH_NAME.
'use strict';
const Module = require('module');
const path = require('path');
const fs = require('fs');

// REH_BUILD: another build of the client's main (a release's, from its own worktree) to rehearse it the same way.
const BUILD = process.env.REH_BUILD || path.join(__dirname, '..', '..', 'build', 'main');
const userData = process.env.REH_USERDATA;
const dataDir = process.env.REH_DATADIR;
const name = process.env.REH_NAME || 'client';
const t0 = Date.now();
const say = (kind, o = {}) => process.stdout.write(JSON.stringify({ t: Date.now() - t0, kind, ...o }) + '\n');

// Electron, as the packaged app sees it: its userData (where sidecar/ is), a version, packaged.
const electronStub = {
    app: { getPath: () => userData, getVersion: () => '0.2.19-rehearsal', isPackaged: true, getAppPath: () => path.join(__dirname, '..', '..') },
    net: { fetch: (...a) => fetch(...a) },
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    return load.call(this, request, parent, isMain);
};

const { Discovery } = require(path.join(BUILD, 'discovery.js'));
const S = require(path.join(BUILD, 'farmSelect.js'));
const { SidecarSupervisor } = require(path.join(BUILD, 'sidecar.js'));

const sidecar = new SidecarSupervisor();
let last = '';
sidecar.on('state', (s) => {
    const k = `${s.status}|${s.message || ''}`;
    if (k === last) return;
    last = k;
    say('owui', { status: s.status, message: s.message || null, repairable: !!s.repairable, url: s.url || null });
});

// What index.ts keeps between events (its module state and the saved settings), here in memory.
const settings = { knownFarms: {}, selectedFarmId: null };
let activeFarmId = null;
let current = null;            // the FarmContext Open WebUI runs with
let booted = false;

function choose(farms) {
    return S.chooseActive(farms, {
        selectedFarmId: settings.selectedFarmId, activeFarmId, currentEndpoint: current ? current.endpoint : null,
        usable: () => true, known: (f) => settings.knownFarms[f.id] === f._host, now: Date.now(),
    });
}
function connectTo(f) {
    if (activeFarmId !== f.id) say('choice', { farm: f.name, id: f.id.slice(0, 8), endpoint: S.farmEndpoint(f) });
    activeFarmId = f.id;
    if (!Object.keys(settings.knownFarms).length) settings.knownFarms[f.id] = f._host;
    const next = S.farmContext(f, null);
    const plan = S.connectPlan(next, current, {});
    if (!plan.repoint) return;
    current = next;
    say('repoint', { farm: f.name, endpoint: next.endpoint });
    sidecar.repoint(next.endpoint, next.key, next.model, next.searxng, next.tts, next.extract, next.ctxPerSlot, next.embed, next.stt);
}

const discovery = new Discovery({ manualPeers: [], autoScan: false, scanRange: null });
discovery.on('farms', (p) => {
    say('farms', { seen: p.farms.map((f) => `${f.name}${f._stale ? ' (stale)' : ''}`) });
    if (!booted) return;
    const f = choose(p.farms);
    if (f) connectTo(f);
});
discovery.start();

(async () => {
    say('launch', { name, dataDir });
    // index.ts: wait up to 4.5 s for a first farm, then start Open WebUI on it (or on none).
    let first = null;
    const until = Date.now() + 4500;
    while (!first && Date.now() < until) { first = choose(discovery.getFarms()); if (!first) await new Promise((r) => setTimeout(r, 300)); }
    if (first) {
        activeFarmId = first.id;
        settings.knownFarms[first.id] = first._host;
        current = S.farmContext(first, null);
        say('choice', { farm: first.name, id: first.id.slice(0, 8), endpoint: current.endpoint, atBoot: true });
    }
    booted = true;
    await sidecar.start({ endpoint: current ? current.endpoint : null, dataDir, apiKey: null, defaultModel: current ? current.model : null,
        searxngUrl: null, tts: null, extract: null, embed: null, stt: null, contextPerSlot: current ? current.ctxPerSlot : null });
})().catch((e) => say('crash', { error: String(e && e.stack || e) }));

const stop = async () => { say('stopping'); try { discovery.stop(); } catch { /* gone */ } try { await sidecar.stop(); } catch { /* gone */ } say('stopped'); process.exit(0); };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.on('data', (d) => { if (String(d).includes('stop')) void stop(); });
process.stdin.on('end', () => void stop());
