// startMock(): the whole mock farm in-process (plan §2.3, §2.6 A).
//
//   const mock = await startMock({ port: 0, keyedPort: 0, key: 'pw', servicesPort: 0, httpPort: 0 });
//   ...            // mock.ports tells you what the ephemeral ports actually are
//   await mock.close();
//
// TWO safety rules are enforced here and nowhere else, because this box runs a live farm
// and the owner's real client (plan §2, override 3):
//
//  1. FORBIDDEN PORTS. {4000, 4001, 41997, 41998, 8081, 8888, 8890, 11434} are refused on
//     the COMPUTED ports, slot or no slot.
//  2. THE BEACON. A UDP socket is created only when `beacon:true` AND
//     process.env.LOL_MOCK_BEACON_OK === '1'. The env var is never set on this box: the
//     owner's client listens on 41998, prefers coordinators, and would switch to "Mock
//     Farm" and restart their Open WebUI. `require('dgram')` itself happens lazily inside
//     that branch, so a run that must not beacon never even loads the module.
'use strict';

const http = require('http');
const { createStore } = require('./state');
const { createProxyHandler } = require('./proxy');
const { createServicesHandler, snapshot } = require('./services');

const FORBIDDEN_PORTS = [4000, 4001, 41997, 41998, 8081, 8888, 8890, 11434];

/** Slot 0 bases; a slot n offsets every port by 20n (plan §2.6 A). */
const BASE_PORTS = { port: 4009, keyedPort: 4010, servicesPort: 4011, httpPort: 41987 };
const SLOT_STRIDE = 20;

function portsForSlot(slot = 0) {
    const n = Number(slot) || 0;
    return {
        port: BASE_PORTS.port + SLOT_STRIDE * n,
        keyedPort: BASE_PORTS.keyedPort + SLOT_STRIDE * n,
        servicesPort: BASE_PORTS.servicesPort + SLOT_STRIDE * n,
        httpPort: BASE_PORTS.httpPort + SLOT_STRIDE * n,
    };
}

/** @throws when `port` is one the live stack owns. 0 (ephemeral) is always allowed. */
function assertPortAllowed(role, port) {
    const p = Number(port);
    if (!p) return;
    if (FORBIDDEN_PORTS.includes(p)) {
        throw new Error(`refusing to bind ${role} to forbidden port ${p} — that port belongs to the live farm/client (${FORBIDDEN_PORTS.join(', ')})`);
    }
}
function assertPortsAllowed(ports) {
    for (const [role, port] of Object.entries(ports)) assertPortAllowed(role, port);
}

/**
 * The beacon decision, in one place so it can be unit-tested without sockets.
 * @param {string[]} argv
 * @param {Record<string,string|undefined>} env
 */
function beaconAllowed(argv, env) {
    if (argv.includes('--no-beacon')) return false;
    return (env && env.LOL_MOCK_BEACON_OK) === '1';
}

const BEACON_DISABLED_LINE = 'beacon disabled (set LOL_MOCK_BEACON_OK=1 only on a machine with no LlmOnLan client running)';

/**
 * Parse the CLI flags (plan §2.3 + §2.6 A).
 * An explicitly-passed port is used AS GIVEN; the slot only offsets the DEFAULTS, so
 * `--slot 1` and `--port 4029 --slot 1` mean the same thing and never double-offset.
 */
function parseArgs(argv = [], env = process.env) {
    const get = (flag) => {
        const i = argv.indexOf(flag);
        return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
    };
    const num = (flag, dflt) => {
        const v = get(flag);
        return v === null ? dflt : Number(v);
    };
    const slot = num('--slot', 0);
    const d = portsForSlot(slot);
    return {
        slot,
        port: num('--port', d.port),
        keyedPort: num('--keyed-port', d.keyedPort),
        key: get('--key'),
        servicesPort: num('--services-port', d.servicesPort),
        httpPort: num('--http-port', d.httpPort),
        beaconPort: num('--beacon-port', 41998),
        beaconHost: get('--beacon-host') || '127.0.0.1',
        beacon: beaconAllowed(argv, env),
        coordinator: argv.includes('--coordinator'),
        quiet: argv.includes('--quiet'),
    };
}

function listen(server, port, host) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address().port); });
    });
}

/**
 * Start the mock. Ports may be 0 (ephemeral) — read the real ones back from `.ports`.
 * @returns {Promise<{close:()=>Promise<void>, state:object, log:object[], store:object,
 *                    ports:{proxy:number,keyed:number|null,services:number,http:number},
 *                    urls:{proxy:string,keyed:string|null,services:string,self:string},
 *                    beacon:boolean}>}
 */
async function startMock(opts = {}) {
    const host = opts.host || '127.0.0.1';
    const key = opts.key || null;
    const wantKeyed = opts.keyedPort !== undefined && opts.keyedPort !== null && key;
    const quiet = !!opts.quiet;
    const say = (m) => { if (!quiet) console.log(`[mock] ${m}`); };

    // Every CONFIGURED port is checked, not just the ones this call will bind: a keyed port that
    // lands on a live-farm port is a broken configuration even when no --key was passed this time
    // (P0 landing, after P0-U2 found `--slot 244` starting with keyed=8890 unchecked).
    assertPortsAllowed({
        proxy: opts.port,
        keyed: opts.keyedPort,
        services: opts.servicesPort,
        http: opts.httpPort,
    });
    // The guard covers the ports we BIND or would bind. The beacon's DESTINATION is 41998 by
    // definition (that is where a client listens); it is gated by the env var below, not by this
    // list, and the UDP socket itself binds an ephemeral port.

    const store = createStore();
    if (opts.coordinator) store.state.coordinator = true;

    /** @type {Set<import('net').Socket>} */
    const sockets = new Set();
    const track = (server) => {
        server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
        return server;
    };

    const ports = { proxy: 0, keyed: null, services: 0, http: 0 };

    const proxyServer = track(http.createServer(createProxyHandler({ store, role: 'proxy', key: null })));
    ports.proxy = await listen(proxyServer, opts.port === undefined ? BASE_PORTS.port : opts.port, host);

    let keyedServer = null;
    if (wantKeyed) {
        keyedServer = track(http.createServer(createProxyHandler({ store, role: 'keyed', key })));
        ports.keyed = await listen(keyedServer, opts.keyedPort, host);
    }

    const snapshotFn = () => snapshot(store, { proxyPort: ports.proxy, httpPort: ports.http, host });

    const servicesServer = track(http.createServer(createServicesHandler({ store, snapshotFn, role: 'services' })));
    ports.services = await listen(servicesServer, opts.servicesPort === undefined ? BASE_PORTS.servicesPort : opts.servicesPort, host);

    const httpServer = track(http.createServer(createServicesHandler({ store, snapshotFn, role: 'http' })));
    ports.http = await listen(httpServer, opts.httpPort === undefined ? BASE_PORTS.httpPort : opts.httpPort, host);

    // ---- the beacon, behind both locks ---------------------------------------------------
    let beaconHandle = null;
    const beaconOn = opts.beacon === true && process.env.LOL_MOCK_BEACON_OK === '1';
    if (beaconOn) {
        // Lazy on purpose: no dgram module, no socket, on a run that must not beacon.
        const dgram = require('dgram');
        const sock = dgram.createSocket('udp4');
        const beaconPort = opts.beaconPort || 41998;
        const beaconHost = opts.beaconHost || '127.0.0.1';
        const intervalMs = opts.beaconIntervalMs || 1500;
        let timer = null;
        sock.bind(() => {
            timer = setInterval(() => {
                const buf = Buffer.from(JSON.stringify(snapshotFn()));
                sock.send(buf, 0, buf.length, beaconPort, beaconHost);
            }, intervalMs);
            if (timer.unref) timer.unref();
        });
        beaconHandle = { close() { if (timer) clearInterval(timer); try { sock.close(); } catch { /* not bound */ } } };
        store.beacon = true;
        say(`beacon -> ${beaconHost}:${beaconPort} every ${intervalMs}ms${opts.coordinator ? ' (coordinator)' : ''}`);
    } else {
        store.beacon = false;
        say(BEACON_DISABLED_LINE);
    }

    say(`proxy on ${host}:${ports.proxy}`);
    if (ports.keyed) say(`keyed proxy on ${host}:${ports.keyed} (Authorization: Bearer ${key})`);
    say(`services on ${host}:${ports.services}`);
    say(`/lol/self on ${host}:${ports.http}`);

    const closeServer = (s) => new Promise((resolve) => { if (!s) return resolve(); s.close(() => resolve()); });

    return {
        store,
        state: store.state,
        log: store.log,
        ports,
        urls: {
            proxy: `http://${host}:${ports.proxy}`,
            keyed: ports.keyed ? `http://${host}:${ports.keyed}` : null,
            services: `http://${host}:${ports.services}`,
            self: `http://${host}:${ports.http}/lol/self`,
        },
        beacon: beaconOn,
        snapshot: snapshotFn,
        async close() {
            if (beaconHandle) beaconHandle.close();
            // An SSE stream holds its socket open; close() would hang waiting for it.
            for (const s of sockets) { try { s.destroy(); } catch { /* gone */ } }
            sockets.clear();
            await Promise.all([proxyServer, keyedServer, servicesServer, httpServer].map(closeServer));
        },
    };
}

module.exports = {
    startMock, parseArgs, beaconAllowed, assertPortAllowed, assertPortsAllowed,
    portsForSlot, FORBIDDEN_PORTS, BASE_PORTS, SLOT_STRIDE, BEACON_DISABLED_LINE, snapshot,
};
