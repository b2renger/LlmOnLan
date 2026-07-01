// `lol fleet` — show every farm on the LAN (this box + peers): health, GPU load,
// VRAM, loaded models, hosts, model catalog, coordinator role. Listens to beacons
// + does a unicast /lol/self sweep for a few seconds, then renders. Read-only.

const http = require('http');
const log = require('../log');
const { loadConfig } = require('../config');
const { PeerListener } = require('../peerListener');
const { farmId } = require('../identity');

function getJson(host, port, path, timeoutMs = 2000) {
    return new Promise((resolve) => {
        const req = http.get({ host, port, path, timeout: timeoutMs }, (res) => {
            if (res.statusCode !== 200) { res.resume(); return resolve(null); }
            let b = '';
            res.on('data', (c) => { b += c; if (b.length > 1_000_000) req.destroy(); });
            res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(null); } });
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

function renderFarm(snap, host, { self = false, ageMs = 0 } = {}) {
    const healthy = snap.healthy !== false;
    const dot = healthy ? log.paint.green('●') : log.paint.red('●');
    const tags = [];
    if (self) tags.push(log.paint.grey('(this box)'));
    if (snap.coordinator) tags.push(log.paint.cyan('[coordinator]'));
    log.plain(`  ${dot} ${log.paint.bold(snap.name)} ${tags.join(' ')}`.trimEnd());

    const endpoint = snap.openaiBaseUrl || `http://${host}:${snap.proxyPort}/v1`;
    log.plain(`      endpoint  ${endpoint}   ${log.paint.grey('farm v' + (snap.version || '?'))}`);
    if (snap.host) {
        log.plain(`      hardware  ${snap.host.gpu} · ${snap.host.vramGb}GB VRAM · ${snap.host.ramGb}GB RAM · ${snap.host.cpuCores} cores`);
    }

    const u = snap.usage || {};
    const h = snap.health || {};
    const parts = [];
    parts.push(u.gpuUtil != null ? log.paint.cyan(`${u.gpuUtil}% GPU`) : log.paint.grey('GPU ?'));
    if (u.vramUsedGb != null && u.vramTotalGb != null) parts.push(`${u.vramUsedGb}/${u.vramTotalGb}GB VRAM`);
    if (h.hostsUp != null) parts.push(`${h.hostsUp}/${h.hostsTotal ?? '?'} hosts up`);
    if (snap.deployments != null) parts.push(`${snap.deployments} backends`);
    const loaded = (u.loaded && u.loaded.length) ? log.paint.cyan(u.loaded.join(', ')) : log.paint.grey('idle');
    parts.push(`loaded: ${loaded}`);
    log.plain(`      load      ${parts.join(' · ')}`);

    const models = (snap.models || []).map((m) => m.id + (m.default ? ' (default)' : '')).join(', ');
    log.plain(`      models    ${models || log.paint.grey('none')}`);
    if (!self) log.plain(log.paint.grey(`      seen ${Math.round(ageMs / 1000)}s ago via ${host}`));
    log.plain('');
}

async function run() {
    let config;
    try { ({ config } = loadConfig()); }
    catch (e) { log.err(e.message); return 1; }

    log.info('Scanning the LAN for farms (beacons + unicast sweep) …');
    const listener = new PeerListener({
        group: config.beacon.group,
        port: config.beacon.port,
        httpPort: config.beacon.httpPort,
        selfId: farmId(),
    }).start();
    const windowMs = Math.max(6000, config.beacon.intervalSec * 2000 + 1500);
    await Promise.all([
        new Promise((r) => setTimeout(r, windowMs)),
        listener.sweep().catch(() => {}),
    ]);
    const peers = listener.getPeers();
    listener.stop();

    // Self — the farm on this box, if `lol up` is running (its /lol/self carries
    // the same live snapshot peers see). Absent if we're not serving.
    const self = await getJson('127.0.0.1', config.beacon.httpPort, '/lol/self');

    const total = (self ? 1 : 0) + peers.length;
    log.plain('');
    log.plain(log.paint.bold(`  Fleet — ${total} farm${total === 1 ? '' : 's'} on the LAN`));
    log.plain('');

    if (self) renderFarm(self, '127.0.0.1', { self: true });
    else log.plain(`  ${log.paint.grey('●')} this box isn't serving — start a farm with ${log.paint.cyan('lol up')}\n`);

    peers.sort((a, b) =>
        (Number(b.snap.healthy !== false) - Number(a.snap.healthy !== false)) ||
        String(a.snap.name).localeCompare(String(b.snap.name)));
    for (const p of peers) renderFarm(p.snap, p.host, { ageMs: p.ageMs });

    if (!peers.length) {
        log.info('No peer farms discovered. On broadcast-blocked Wi-Fi, peers must share this subnet and be reachable.');
    }
    return 0;
}

module.exports = { run };
