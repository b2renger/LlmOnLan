// LAN discovery beacon — adapted from ComfyQ's server/federation/beacon.js.
//
// The FARM broadcasts; the CLIENT (shell) listens. Every `intervalSec` we send
// the discovery snapshot to (a) the multicast group on each interface, (b) each
// interface's directed broadcast (e.g. 10.10.16.255), and (c) the limited
// broadcast 255.255.255.255, deduped. This belt-and-suspenders delivery is what
// makes same-subnet clients actually see the farm: multicast alone is flaky
// across consumer APs, and directed broadcast carries on multi-homed boxes.
//
// Uses Node's built-in dgram (no transport dependency). The multicast group is
// distinct from ComfyQ's (239.255.43.10 vs 239.255.42.99) so both tools coexist.

const dgram = require('dgram');
const { ipv4Interfaces } = require('./net');

class DiscoveryBeacon {
    // getSnapshot() → the current snapshot object (so health/models stay fresh).
    constructor({ group, port, intervalSec, getSnapshot }) {
        this.group = group;
        this.port = port;
        this.intervalMs = Math.max(1, intervalSec) * 1000;
        this.getSnapshot = getSnapshot;
        this.socket = null;
        this.timer = null;
        this._warned = false;
    }

    start() {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socket.on('error', (e) => {
            if (!this._warned) {
                console.warn(`[beacon] socket error (will keep retrying): ${e.message}`);
                this._warned = true;
            }
        });
        socket.bind(() => {
            try { socket.setBroadcast(true); } catch { /* ignore */ }
            // TTL > 1 so the beacon survives a router hop (a Wi-Fi AP that routes
            // rather than bridges); still LAN-scoped.
            try { socket.setMulticastTTL(4); } catch { /* ignore */ }
            this._send(); // immediate first beacon
        });
        this.socket = socket;
        this.timer = setInterval(() => this._send(), this.intervalMs);
        if (this.timer.unref) this.timer.unref();
        return this;
    }

    // Send one beacon now (used right after the farm becomes healthy).
    kick() { this._send(); }

    _send() {
        if (!this.socket) return;
        let buf;
        try {
            buf = Buffer.from(JSON.stringify(this.getSnapshot()));
        } catch (e) {
            if (!this._warned) { console.warn('[beacon] could not build snapshot:', e.message); this._warned = true; }
            return;
        }

        // (a) multicast group, (b) each interface's directed broadcast,
        // (c) limited broadcast. Dedup so we don't send twice to one address.
        const targets = new Set([this.group, '255.255.255.255']);
        for (const i of ipv4Interfaces()) if (i.broadcast) targets.add(i.broadcast);
        for (const addr of targets) {
            this.socket.send(buf, 0, buf.length, this.port, addr, (e) => {
                // Per-target failures are normal (an iface with no route) — warn once.
                if (e && !this._warned) {
                    console.warn(`[beacon] send to ${addr} failed: ${e.message}`);
                    this._warned = true;
                }
            });
        }
    }

    stop() {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.socket) { try { this.socket.close(); } catch { /* ignore */ } this.socket = null; }
    }
}

module.exports = { DiscoveryBeacon };
