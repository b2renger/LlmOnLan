// Network helpers shared by the beacon, the self-endpoint, and status.

const os = require('os');

// Every non-internal IPv4 this machine is reachable on, with netmask + the
// directed broadcast address for that interface. (Same logic as ComfyQ's
// federation/systemInfo.lanAddresses + beacon.broadcastAddr.)
function ipv4Interfaces() {
    const out = [];
    const ifs = os.networkInterfaces();
    for (const name of Object.keys(ifs)) {
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

module.exports = { ipv4Interfaces, lanAddresses, broadcastAddr, primaryAddress };
