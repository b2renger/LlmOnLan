// Network helpers shared by the beacon, the self-endpoint, and status.

const os = require('os');
const net = require('net');

// Container/VM/VPN bridges are NOT the LAN. On the DGX Spark, Docker's compose
// bridge (172.22.0.1, iface `br-<hash>`) was non-internal, so the beacon also
// broadcast on it — and the client running ON that box received copies of the
// beacon sourced from 172.22.0.1, flapped its farm endpoint between that and
// the real LAN address every tick, and restarted its OWUI engine forever
// (live 2026-09-03: the "client can't connect to the farm on the same
// machine" report). Plain `br0` (a real bridged NIC on servers) is deliberately
// NOT matched — only compose's `br-<hex>` shape is.
const VIRTUAL_IFACE_RX = /^(docker|br-[0-9a-f]|veth|virbr|vmnet|vboxnet|lxc|lxd|cni|flannel|podman|tailscale|zt|wg|vEthernet)/i;
function isVirtualIfaceName(name) {
    return VIRTUAL_IFACE_RX.test(String(name || ''));
}

// Every LAN-facing IPv4 this machine is reachable on, with netmask + the
// directed broadcast address for that interface. (Same logic as ComfyQ's
// federation/systemInfo.lanAddresses + beacon.broadcastAddr, plus the virtual-
// interface filter above.)
function ipv4Interfaces() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
        if (isVirtualIfaceName(name)) continue;
        for (const i of ifs[name] || []) {
            if (i.family !== 'IPv4' || i.internal) continue;
            out.push({
                name,
                address: i.address,
                netmask: i.netmask,
                broadcast: broadcastAddr(i.address, i.netmask),
            });
        }
    }
    return out;
}

// Just the addresses (e.g. ["10.10.16.58", "192.168.1.20"]).
function lanAddresses() {
    return ipv4Interfaces().map((i) => i.address);
}

// Directed broadcast for an address+netmask, e.g. 10.10.16.58 / 255.255.255.0
// → 10.10.16.255. Honors the real netmask (a /23 lab → .17.255, not .16.255).
function broadcastAddr(ip, netmask) {
    try {
        const a = ip.split('.').map(Number);
        const m = netmask.split('.').map(Number);
        if (a.length !== 4 || m.length !== 4) return null;
        return a.map((p, i) => (p & m[i]) | (~m[i] & 255)).join('.');
    } catch {
        return null;
    }
}

// Pick the most likely LAN-facing address (first non-internal IPv4) for building
// a default endpoint string when none is configured.
function primaryAddress() {
    return lanAddresses()[0] || '127.0.0.1';
}

// Where the farm's own services listen, derived from config.proxy.host — the ONE
// network-posture knob (the Farm app's private mode sets it to 127.0.0.1 and turns
// the beacon off). The plugins (SearXNG, OCR, Kokoro) used to hard-code 0.0.0.0, so
// a "private" farm still served web search to the whole LAN. Three answers:
//   bind      — what the plugin listens on
//   probe     — where the farm's own health checks reach it
//   advertise — the host put in the snapshot's plugin URLs (null = the primary
//               LAN address). A loopback farm advertises 127.0.0.1: the only
//               client that can read its /lol/self is on the same box, and the
//               LAN address would point that client at a port nothing listens on.
const WILDCARD_RX = /^(0\.0\.0\.0|::|\*|)$/;
const LOOPBACK_RX = /^(127\.\d+\.\d+\.\d+|localhost|::1)$/i;
function serviceHosts(proxyHost) {
    const h = String(proxyHost == null ? '0.0.0.0' : proxyHost).trim();
    if (WILDCARD_RX.test(h)) return { bind: '0.0.0.0', probe: '127.0.0.1', advertise: null, loopback: false };
    if (LOOPBACK_RX.test(h)) return { bind: '127.0.0.1', probe: '127.0.0.1', advertise: '127.0.0.1', loopback: true };
    return { bind: h, probe: h, advertise: h, loopback: false };
}

// The panel's port, held from the start of `lol up` until the panel takes it (WSL_PORTS_PLAN). On Windows, WSL in
// mirrored networking reserves a block of 4,096 ports while its VM runs (Linux's ephemeral range, chosen at the VM's
// boot among the ports in use then: 40525–44620 or 37795–41890 on the PRO 6000), and the farm's first WSL call can be
// that boot. A port held then is in use, so the block goes around it. A connection to the hold is reset at once: the
// client fails fast, as before the panel existed, and no TIME_WAIT is left on the port the panel then listens on. The
// hold never keeps the process alive.
function holdPort(port, host) {
    return new Promise((resolve) => {
        const s = net.createServer((c) => c.resetAndDestroy());
        s.once('error', (e) => resolve({ ok: false, code: e.code, release: async () => {} }));
        s.listen(port, host, () => {
            s.unref();
            resolve({ ok: true, release: () => new Promise((r) => s.close(() => r())) });
        });
    });
}

// Whether a program answers a connection on that port, where the farm's own checks reach it (serviceHosts). A port
// that cannot be bound while nothing answers is WSL's block (a connection there is refused in 1-2 ms, measured
// 2026-11-27).
function answers(port, host, ms = 1500) {
    return new Promise((resolve) => {
        const c = net.connect({ port, host: serviceHosts(host).probe });
        const done = (v) => { c.destroy(); resolve(v); };
        c.setTimeout(ms, () => done(false));
        c.once('connect', () => done(true));
        c.once('error', () => done(false));
    });
}

module.exports = { ipv4Interfaces, lanAddresses, broadcastAddr, primaryAddress, isVirtualIfaceName, serviceHosts, holdPort, answers };
