// peerListener — the FARM side of discovery: hear the OTHER farms on the LAN.
//
// The shell (client) already listens to beacons; this gives the CLI the same
// capability, shared by `lol fleet` (render the fleet) and `lol up --coordinator`
// (aggregate peers into one balanced proxy). Two inputs feed one peer registry
// keyed by farm id:
//   • UDP multicast + directed/limited broadcast (friendly LANs), and
//   • a unicast /lol/self sweep of the local subnets (broadcast-blocked LANs).
// Our own farm is excluded by id (a farm hears its own beacon).
//
// Mirrors the shell's discovery.ts socket + sweep, in CommonJS for the CLI.

const dgram = require('dgram');
const http = require('http');
const { ipv4Interfaces } = require('./net');

const DEFAULT_TTL_MS = 90_000;     // drop a peer unheard this long
const MAX_SWEEP_HOSTS = 4096;      // skip subnets bigger than ~/20 (politeness)
const SWEEP_CONCURRENCY = 48;
const SWEEP_TIMEOUT_MS = 1500;

class PeerListener {
    // group/port: the beacon multicast group + port. httpPort: the /lol/self port
    // for the unicast sweep. selfId: our own farm id (excluded). ttlMs: staleness.
    constructor({ group, port, httpPort, selfId = null, ttlMs = DEFAULT_TTL_MS } = {}) {
        this.group = group;
        this.port = port;
        this.httpPort = httpPort;
        this.selfId = selfId;
        this.ttlMs = ttlMs;
        this.socket = null;
        this.peers = new Map();         // id → { snap, host, lastSeen }
    }

    start() {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socket.on('error', () => { try { socket.close(); } catch { /* ignore */ } this.socket = null; });
        socket.on('message', (msg, rinfo) => {
            let snap;
            try { snap = JSON.parse(msg.toString()); } catch { return; }
            this._merge(snap, rinfo.address);
        });
        // Bind 0.0.0.0:<port> so directed/limited broadcast is received; join the
        // multicast group on the default route AND every interface (multi-homed).
        socket.bind(this.port, () => {
            try { socket.addMembership(this.group); } catch { /* default join may fail */ }
            for (const i of ipv4Interfaces()) { try { socket.addMembership(this.group, i.address); } catch { /* joined */ } }
        });
        this.socket = socket;
        return this;
    }

    stop() {
        if (this.socket) { try { this.socket.close(); } catch { /* ignore */ } this.socket = null; }
    }

    _merge(snap, host) {
        if (!snap || snap.v == null || !snap.id) return;
        if (this.selfId && snap.id === this.selfId) return;    // never count ourselves
        this.peers.set(snap.id, { snap, host, lastSeen: Date.now() });
    }

    // Live peers (stale entries past ttl dropped). Each: { snap, host, ageMs }.
    getPeers() {
        const now = Date.now();
        const out = [];
        for (const [id, rec] of this.peers) {
            if (now - rec.lastSeen > this.ttlMs) { this.peers.delete(id); continue; }
            out.push({ snap: rec.snap, host: rec.host, ageMs: now - rec.lastSeen });
        }
        return out;
    }

    // Unicast sweep of the local subnets → GET /lol/self, for LANs that block
    // broadcast/multicast (managed Wi-Fi). Best-effort; merges whatever answers.
    async sweep() {
        if (!this.httpPort) return;
        const candidates = this._sweepCandidates();
        let idx = 0;
        const worker = async () => {
            while (idx < candidates.length) {
                const host = candidates[idx++];
                const snap = await this._fetchSelf(host);
                if (snap) this._merge(snap, host);
            }
        };
        await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, candidates.length) }, worker));
    }

    _sweepCandidates() {
        const mine = new Set(ipv4Interfaces().map((i) => i.address));
        const seen = new Set();
        const out = [];
        for (const i of ipv4Interfaces()) {
            const a = i.address.split('.').map(Number);
            const m = i.netmask.split('.').map(Number);
            if (a.length !== 4 || m.length !== 4) continue;
            const net = a.map((x, k) => x & m[k]);
            const bc = a.map((x, k) => (x & m[k]) | (~m[k] & 255));
            const size = (bc[0] - net[0] + 1) * (bc[1] - net[1] + 1) * (bc[2] - net[2] + 1) * (bc[3] - net[3] + 1);
            if (size > MAX_SWEEP_HOSTS) continue;   // too big to sweep politely
            for (let o1 = net[0]; o1 <= bc[0]; o1++)
                for (let o2 = net[1]; o2 <= bc[1]; o2++)
                    for (let o3 = net[2]; o3 <= bc[2]; o3++)
                        for (let o4 = net[3]; o4 <= bc[3]; o4++) {
                            const ip = `${o1}.${o2}.${o3}.${o4}`;
                            if (mine.has(ip) || seen.has(ip)) continue;
                            seen.add(ip); out.push(ip);
                            if (out.length >= MAX_SWEEP_HOSTS) return out;
                        }
        }
        return out;
    }

    _fetchSelf(host) {
        return new Promise((resolve) => {
            const req = http.get({ host, port: this.httpPort, path: '/lol/self', timeout: SWEEP_TIMEOUT_MS }, (res) => {
                if (res.statusCode !== 200) { res.resume(); return resolve(null); }
                let b = '';
                res.on('data', (c) => { b += c; if (b.length > 1_000_000) req.destroy(); });
                res.on('end', () => { try { const s = JSON.parse(b); resolve(s && s.v != null ? s : null); } catch { resolve(null); } });
            });
            req.on('timeout', () => req.destroy());
            req.on('error', () => resolve(null));
        });
    }
}

module.exports = { PeerListener };
