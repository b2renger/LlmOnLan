// LAN farm discovery — the client half of M3. Adapted from ComfyQ's
// desktop/main.js. Finds farms three ways and merges them into one map:
//   1. UDP beacons (multicast + broadcast) — zero-config on friendly LANs.
//   2. Subnet sweep — unicast GET http://<ip>:<httpPort>/lol/self across a range
//      (this is what finds farms on managed/school Wi-Fi that blocks broadcast).
//   3. Manually added hosts (a farm on another subnet).
// Emits 'farms' (the list, for the connection UX) and 'active' (the chosen
// farm's endpoint, which index.ts feeds to the sidecar config-bridge).

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as http from 'http';
import * as os from 'os';
import { FarmSnapshot, DiscoveredFarm, ScanRange } from './types';

const GROUP = process.env.LOL_FED_GROUP || '239.255.43.10';
const PORT = Number(process.env.LOL_FED_PORT || 41998);
const DEFAULT_HTTP_PORT = Number(process.env.LOL_FED_HTTP_PORT || 41997);

const POLL_MS = 5_000;          // refresh known farms (manual + discovered)
const SCAN_MS = 60_000;         // full sweep cadence
const SCAN_CONCURRENCY = 48;
const SCAN_TIMEOUT_MS = 1500;
const MAX_SCAN_HOSTS = 4096;
const DISCOVERED_TTL = 90_000;  // stop polling an auto-found host unseen this long
const STALE_MS = 30_000;
const DROP_MS = 120_000;

interface PeerRec { snap: FarmSnapshot; host: string; lastSeen: number; source: 'beacon' | 'scan' | 'added'; }

export class Discovery extends EventEmitter {
    private socket: dgram.Socket | null = null;
    private peers = new Map<string, PeerRec>();        // id → record
    private discovered = new Map<string, number>();    // host → lastResponseTs
    private manualPeers: string[] = [];
    private autoScan = true;
    private scanRange: ScanRange | null = null;
    private scanning = false;
    private timers: NodeJS.Timeout[] = [];

    constructor(opts: { manualPeers?: string[]; autoScan?: boolean; scanRange?: ScanRange | null } = {}) {
        super();
        this.manualPeers = opts.manualPeers || [];
        this.autoScan = opts.autoScan !== false;
        this.scanRange = opts.scanRange || this.defaultRange();
    }

    // ---- lifecycle ----
    start(): void {
        this.startSocket();
        this.pollKnown();
        this.timers.push(setInterval(() => this.pollKnown(), POLL_MS));
        this.timers.push(setTimeout(() => this.sweep(), 800));
        this.timers.push(setInterval(() => this.sweep(), SCAN_MS));
        this.timers.push(setInterval(() => this.prune(), 5000));
    }
    stop(): void {
        for (const t of this.timers) clearInterval(t as NodeJS.Timeout);
        this.timers = [];
        if (this.socket) { try { this.socket.close(); } catch { /* ignore */ } this.socket = null; }
    }

    // ---- public controls (wired to IPC) ----
    getManualPeers(): string[] { return this.manualPeers.slice(); }
    getScanRange(): ScanRange | null { return this.scanRange; }
    getAutoScan(): boolean { return this.autoScan; }

    addManualPeer(entry: string): string[] {
        const h = String(entry || '').trim();
        if (h && !this.manualPeers.includes(h)) { this.manualPeers.push(h); this.pollKnown(); }
        this.emitState();
        return this.getManualPeers();
    }
    removeManualPeer(entry: string): string[] {
        this.manualPeers = this.manualPeers.filter((p) => p !== entry);
        this.emitState();
        return this.getManualPeers();
    }
    setAutoScan(on: boolean): boolean {
        this.autoScan = !!on;
        if (this.autoScan) this.sweep();
        this.emitState();
        return this.autoScan;
    }
    setScanRange(r: ScanRange): ScanRange | null {
        if (r && typeof r.base === 'string' && Array.isArray(r.third) && Array.isArray(r.fourth)) {
            const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
            this.scanRange = { base: r.base.trim().replace(/\.+$/, ''), third: [clamp(r.third[0]), clamp(r.third[1])], fourth: [clamp(r.fourth[0]), clamp(r.fourth[1])] };
            if (this.autoScan) this.sweep();
        }
        this.emitState();
        return this.scanRange;
    }
    rescan(): void { this.sweep(); }

    // ---- the merged farm list ----
    getFarms(): DiscoveredFarm[] {
        const now = Date.now();
        const out: DiscoveredFarm[] = [];
        for (const [, rec] of this.peers) {
            const age = now - rec.lastSeen;
            out.push({ ...rec.snap, _source: rec.source, _host: rec.host, _lastSeen: rec.lastSeen, _stale: age > STALE_MS });
        }
        // Healthy + non-stale first, then by name.
        out.sort((a, b) => (Number(b.healthy && !b._stale) - Number(a.healthy && !a._stale)) || a.name.localeCompare(b.name));
        return out;
    }

    // ---- internals ----
    private localIPv4s(): { address: string; netmask: string }[] {
        const out: { address: string; netmask: string }[] = [];
        for (const list of Object.values(os.networkInterfaces())) {
            for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push({ address: i.address, netmask: i.netmask });
        }
        return out;
    }
    private defaultRange(): ScanRange {
        const me = this.localIPv4s()[0];
        if (!me) return { base: '192.168.1', third: [1, 1], fourth: [1, 254] };
        const o = me.address.split('.').map(Number);
        const m = me.netmask.split('.').map(Number);
        const net = o.map((x, i) => x & m[i]);
        const bc = o.map((x, i) => (x & m[i]) | (~m[i] & 255));
        return { base: `${o[0]}.${o[1]}`, third: [net[2], bc[2]], fourth: [Math.max(1, net[3]), Math.min(254, bc[3] || 254)] };
    }
    private parseHost(entry: string): { host: string; port: number } {
        const [host, port] = String(entry).split(':');
        return { host: host.trim(), port: Number(port) || DEFAULT_HTTP_PORT };
    }
    private scanCandidates(): string[] {
        const r = this.scanRange || this.defaultRange();
        const mine = new Set(this.localIPv4s().map((i) => i.address));
        const [t0, t1] = r.third, [f0, f1] = r.fourth;
        const out: string[] = [];
        for (let t = Math.min(t0, t1); t <= Math.max(t0, t1); t++) {
            for (let f = Math.min(f0, f1); f <= Math.max(f0, f1); f++) {
                const ip = `${r.base}.${t}.${f}`;
                if (!mine.has(ip)) out.push(ip);
                if (out.length >= MAX_SCAN_HOSTS) return out;
            }
        }
        return out;
    }

    private fetchSelf(host: string, port: number, timeoutMs: number): Promise<FarmSnapshot | null> {
        return new Promise((resolve) => {
            const req = http.get({ host, port, path: '/lol/self', timeout: timeoutMs }, (res) => {
                if (res.statusCode !== 200) { res.resume(); return resolve(null); }
                let b = '';
                res.on('data', (c) => { b += c; if (b.length > 1_000_000) req.destroy(); });
                res.on('end', () => { try { const s = JSON.parse(b); resolve(s && s.v != null ? s : null); } catch { resolve(null); } });
            });
            req.on('timeout', () => req.destroy());
            req.on('error', () => resolve(null));
        });
    }

    private merge(snap: FarmSnapshot, host: string, source: PeerRec['source']): void {
        const id = snap.id || `${host}:${snap.proxyPort || ''}`;
        this.peers.set(id, { snap, host, lastSeen: Date.now(), source });
    }

    private async pollKnown(): Promise<void> {
        const manualHosts = new Set(this.manualPeers.map((e) => this.parseHost(e).host));
        const targets = new Set<string>([...this.manualPeers, ...this.discovered.keys()]);
        await Promise.all([...targets].map(async (entry) => {
            const { host, port } = this.parseHost(entry);
            if (!host) return;
            const snap = await this.fetchSelf(host, port, SCAN_TIMEOUT_MS);
            if (snap) {
                if (this.discovered.has(host)) this.discovered.set(host, Date.now());
                this.merge(snap, host, manualHosts.has(host) ? 'added' : 'scan');
                this.emitState();
            }
        }));
    }

    private async sweep(): Promise<void> {
        if (this.scanning || !this.autoScan) return;
        const all = this.scanCandidates();
        if (!all.length) return;
        this.scanning = true; this.emitState();
        const manualHosts = new Set(this.manualPeers.map((e) => this.parseHost(e).host));
        let idx = 0;
        const worker = async () => {
            while (idx < all.length) {
                const host = all[idx++];
                const snap = await this.fetchSelf(host, DEFAULT_HTTP_PORT, SCAN_TIMEOUT_MS);
                if (snap) { this.discovered.set(host, Date.now()); this.merge(snap, host, manualHosts.has(host) ? 'added' : 'scan'); this.emitState(); }
            }
        };
        await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, all.length) }, worker));
        this.scanning = false; this.emitState();
    }

    private startSocket(): void {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        socket.on('error', () => { try { socket.close(); } catch { /* ignore */ } setTimeout(() => this.startSocket(), 3000); });
        socket.on('message', (msg, rinfo) => {
            let snap: FarmSnapshot;
            try { snap = JSON.parse(msg.toString()); } catch { return; }
            if (!snap || snap.v == null) return;
            this.merge(snap, rinfo.address, 'beacon');
            this.emitState();
        });
        socket.bind(PORT, () => {
            try { socket.addMembership(GROUP); } catch { /* default join may fail */ }
            for (const i of this.localIPv4s()) { try { socket.addMembership(GROUP, i.address); } catch { /* joined */ } }
            console.log(`[discovery] listening ${GROUP}:${PORT} (+ broadcast)`);
        });
        this.socket = socket;
    }

    private prune(): void {
        const now = Date.now();
        for (const [host, ts] of this.discovered) if (now - ts > DISCOVERED_TTL) this.discovered.delete(host);
        for (const [id, rec] of this.peers) {
            if (rec.source === 'added') continue;           // keep manually-added even when stale
            if (now - rec.lastSeen > DROP_MS) this.peers.delete(id);
        }
        this.emitState();
    }

    private emitState(): void {
        this.emit('farms', {
            farms: this.getFarms(),
            manualPeers: this.getManualPeers(),
            autoScan: this.autoScan,
            scanRange: this.scanRange,
            scanning: this.scanning,
            selfIps: this.localIPv4s().map((i) => i.address),
        });
    }
}
