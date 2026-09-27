// The Computer's outputs to the real world — the ONE choke point (docs/ECOSYSTEM_PLAN.md v2 §3.5, P3a).
// Every message a graph sends to a device goes through `send()` here, in the main process, where the
// safety rules cannot be skipped by a renderer bug or an imported graph:
//   - DISARMED by default, and disarmed again whenever the window (re)loads: an unarmed send is a DRY
//     RUN — the box shows what it would send, nothing leaves;
//   - a person-typed target only (the renderer passes the box's settings, never a wire's value);
//   - never the farm's own ports (this machine IS allowed: OSC to TouchDesigner or Max on 127.0.0.1
//     is the classic case, and a lighting node on a link-local address is normal);
//   - a rate limit per target, and DMX frames capped at 3 a second PER UNIVERSE, whatever address
//     they go to (photosensitivity). What this cannot cover, and the words say so: a fixture's own
//     strobe channel, and lights driven over OSC, MQTT, WebSocket or HTTP (20 messages a second);
//   - PANIC: disarm, then send every DMX universe used a blackout frame.
// Transports use only Node's standard library: UDP (dgram) for OSC and Art-Net, TCP (net) for an
// MQTT publish, the global WebSocket and fetch for WebSocket and HTTP POST.

import * as dgram from 'dgram';
import * as net from 'net';
import { FARM_PORTS } from './io';

export type Transport = 'osc' | 'artnet' | 'mqtt' | 'ws' | 'http' | 'serial';
export interface SendRequest {
    transport: Transport;
    host?: string; port?: number;           // osc, artnet, mqtt
    url?: string;                           // ws, http
    address?: string;                       // osc: /path
    universe?: number;                      // artnet: 0..32767
    topic?: string;                         // mqtt
    serialPort?: string;                    // serial: the board the person picked (net/serial.mjs identity)
    value: unknown;                         // what to send (see encode below)
}
export type SendAnswer = { ok: true; sent: boolean; summary: string } | { ok: false; code: string; message: string };

const DMX_MIN_MS = 334;      // ≤ 3 frames a second, per universe and host
const MSG_MIN_MS = 50;       // ≤ 20 messages a second, per target
const TIMEOUT_MS = 5000;

let armed = false;
const lastSent = new Map<string, number>();
const dmxTargets = new Map<string, { host: string; port: number; universe: number }>();

export function isArmed(): boolean { return armed; }
export function arm(on: boolean): boolean { armed = !!on; return armed; }

// ---- encoders (pure, exported for the tests) ------------------------------------------------------

function pad4(b: Buffer): Buffer { const n = (4 - (b.length % 4)) % 4; return Buffer.concat([b, Buffer.alloc(n)]); }
function oscString(s: string): Buffer { return pad4(Buffer.concat([Buffer.from(s, 'utf8'), Buffer.alloc(1)])); }

/** One OSC message: numbers become float32 ('f'), integers int32 ('i'), everything else a string. */
export function encodeOsc(address: string, value: unknown): Buffer {
    const args = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    let tags = ',';
    const parts: Buffer[] = [];
    for (const a of args) {
        if (typeof a === 'number' && Number.isInteger(a)) { tags += 'i'; const b = Buffer.alloc(4); b.writeInt32BE(a); parts.push(b); }
        else if (typeof a === 'number') { tags += 'f'; const b = Buffer.alloc(4); b.writeFloatBE(a); parts.push(b); }
        else if (typeof a === 'boolean') { tags += a ? 'T' : 'F'; }
        else { tags += 's'; parts.push(oscString(typeof a === 'string' ? a : JSON.stringify(a))); }
    }
    return Buffer.concat([oscString(address), oscString(tags), ...parts]);
}

/** Channel values 0..255 from a list [v1, v2, …] (channel 1 first) or an object {"1": v, "12": v}. */
export function dmxChannels(value: unknown): Uint8Array {
    const out = new Uint8Array(512);
    const put = (ch: number, v: unknown) => {
        const n = Math.round(Number(v));
        if (ch >= 1 && ch <= 512 && Number.isFinite(n)) out[ch - 1] = Math.max(0, Math.min(255, n));
    };
    if (Array.isArray(value)) value.forEach((v, i) => put(i + 1, v));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) put(Number(k), v);
    return out;
}

/** An Art-Net ArtDmx packet (Art-Net 4, OpCode 0x5000, protocol 14) carrying all 512 channels. */
export function encodeArtDmx(universe: number, channels: Uint8Array, sequence = 0): Buffer {
    const b = Buffer.alloc(18 + 512);
    b.write('Art-Net\0', 0, 'ascii');
    b.writeUInt16LE(0x5000, 8);
    b.writeUInt16BE(14, 10);
    b.writeUInt8(sequence & 0xff, 12);
    b.writeUInt8(0, 13);
    b.writeUInt8(universe & 0xff, 14);          // SubUni
    b.writeUInt8((universe >> 8) & 0x7f, 15);   // Net
    b.writeUInt16BE(512, 16);
    Buffer.from(channels).copy(b, 18);
    return b;
}

function mqttLength(n: number): Buffer {
    const bytes: number[] = [];
    do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 0x80; bytes.push(d); } while (n > 0);
    return Buffer.from(bytes);
}
function mqttString(s: string): Buffer { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); }

/** MQTT 3.1.1: CONNECT (clean session, no credentials), PUBLISH QoS 0, DISCONNECT. */
export function encodeMqtt(clientId: string, topic: string, payload: Buffer): { connect: Buffer; publish: Buffer; disconnect: Buffer } {
    const vh = Buffer.concat([mqttString('MQTT'), Buffer.from([4, 0x02, 0, 30])]);
    const cp = Buffer.concat([vh, mqttString(clientId)]);
    const pp = Buffer.concat([mqttString(topic), payload]);
    return {
        connect: Buffer.concat([Buffer.from([0x10]), mqttLength(cp.length), cp]),
        publish: Buffer.concat([Buffer.from([0x30]), mqttLength(pp.length), pp]),
        disconnect: Buffer.from([0xe0, 0x00]),
    };
}

function asText(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value); }

// ---- the checks ---------------------------------------------------------------------------------

function targetOf(r: SendRequest): { ok: true; key: string; label: string } | { ok: false; code: string; message: string } {
    // USB serial (P3a-2): the page writes the bytes through Web Serial; this decides whether it may.
    if (r.transport === 'serial') {
        const port = String(r.serialPort || '').trim();
        if (!port) return { ok: false, code: 'E_TARGET', message: 'choose the board first' };
        return { ok: true, key: `serial|${port}`, label: port };
    }
    if (r.transport === 'ws' || r.transport === 'http') {
        let u: URL;
        try { u = new URL(String(r.url || '')); } catch { return { ok: false, code: 'E_TARGET', message: 'not an address' }; }
        const okScheme = r.transport === 'ws' ? (u.protocol === 'ws:' || u.protocol === 'wss:') : (u.protocol === 'http:' || u.protocol === 'https:');
        if (!okScheme) return { ok: false, code: 'E_TARGET', message: `a ${r.transport === 'ws' ? 'ws://' : 'http://'} address is needed` };
        if (u.username || u.password) return { ok: false, code: 'E_TARGET', message: 'no credentials in the address' };
        const port = Number(u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80));
        if (FARM_PORTS.has(port)) return { ok: false, code: 'E_FARM', message: String(port) };
        return { ok: true, key: `${r.transport}|${u.host}${u.pathname}`, label: u.href };
    }
    const host = String(r.host || '').trim();
    const port = Number(r.port);
    if (!host || /[\s/]/.test(host)) return { ok: false, code: 'E_TARGET', message: 'a host is needed' };
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, code: 'E_TARGET', message: 'a port 1–65535 is needed' };
    if (FARM_PORTS.has(port)) return { ok: false, code: 'E_FARM', message: String(port) };
    if (r.transport === 'artnet') {
        const u = Number(r.universe);
        if (!Number.isInteger(u) || u < 0 || u > 32767) return { ok: false, code: 'E_TARGET', message: 'a universe 0–32767 is needed' };
        return { ok: true, key: `artnet|${host}|${u}`, label: `${host} universe ${u}` };
    }
    if (r.transport === 'osc' && !/^\/[^\s#*,?[\]{}]*$/.test(String(r.address || ''))) return { ok: false, code: 'E_TARGET', message: 'an OSC address starting with / is needed' };
    if (r.transport === 'mqtt' && !String(r.topic || '').trim()) return { ok: false, code: 'E_TARGET', message: 'a topic is needed' };
    return { ok: true, key: `${r.transport}|${host}:${port}|${r.address || r.topic || ''}`, label: `${host}:${port}` };
}

function describe(r: SendRequest): string {
    switch (r.transport) {
        case 'osc': return `OSC ${r.address} ${asText(r.value)}`;
        case 'artnet': { const ch = dmxChannels(r.value); const set = Array.from(ch).map((v, i) => [i + 1, v]).filter(([, v]) => v > 0); return `DMX u${r.universe}: ${set.length ? set.slice(0, 8).map(([c, v]) => `${c}=${v}`).join(' ') + (set.length > 8 ? ' …' : '') : 'all 0'}`; }
        case 'mqtt': return `MQTT ${r.topic} ← ${asText(r.value).slice(0, 80)}`;
        case 'ws': return `WebSocket ← ${asText(r.value).slice(0, 80)}`;
        case 'http': return `POST ← ${asText(r.value).slice(0, 80)}`;
        case 'serial': return `USB ← ${asText(r.value).slice(0, 80)}`;
    }
    return '';
}

// ---- the senders -------------------------------------------------------------------------------

function udp(host: string, port: number, bytes: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        const sock = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');
        sock.once('error', (e) => { try { sock.close(); } catch { /* closed */ } reject(e); });
        sock.bind(0, () => {
            try { sock.setBroadcast(true); } catch { /* not a broadcast target */ }
            sock.send(bytes, port, host, (e) => { try { sock.close(); } catch { /* closed */ } if (e) reject(e); else resolve(); });
        });
    });
}

function mqttPublish(host: string, port: number, topic: string, payload: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        const pk = encodeMqtt(`lol-${process.pid}-${Date.now() % 100000}`, topic, payload);
        const sock = net.connect({ host, port });
        const timer = setTimeout(() => { sock.destroy(); reject(new Error('the broker did not answer')); }, TIMEOUT_MS);
        sock.once('error', (e) => { clearTimeout(timer); reject(e); });
        sock.once('connect', () => sock.write(pk.connect));
        sock.once('data', (d) => {
            if (d[0] !== 0x20 || d[3] !== 0) { clearTimeout(timer); sock.destroy(); reject(new Error(`the broker refused the connection (code ${d[3]})`)); return; }
            sock.write(pk.publish);
            sock.end(pk.disconnect, () => { clearTimeout(timer); resolve(); });
        });
    });
}

function wsSend(url: string, text: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const WS = (globalThis as any).WebSocket;
        if (typeof WS !== 'function') { reject(new Error('no WebSocket in this Node')); return; }
        const ws = new WS(url);
        const timer = setTimeout(() => { try { ws.close(); } catch { /* closed */ } reject(new Error('no answer')); }, TIMEOUT_MS);
        ws.onopen = () => { ws.send(text); clearTimeout(timer); setTimeout(() => { try { ws.close(); } catch { /* closed */ } resolve(); }, 50); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('the WebSocket could not connect')); };
    });
}

export interface SendDeps { now?: () => number; transportImpl?: Partial<{ udp: typeof udp; mqtt: typeof mqttPublish; ws: typeof wsSend; http: (url: string, body: string) => Promise<void> }> }

/** Send one message — or, disarmed, say what would have been sent. Never throws. */
export async function send(r: SendRequest, deps: SendDeps = {}): Promise<SendAnswer> {
    const now = (deps.now || Date.now)();
    const impl = { udp, mqtt: mqttPublish, ws: wsSend, http: httpPost, ...(deps.transportImpl || {}) };
    if (!r || !['osc', 'artnet', 'mqtt', 'ws', 'http', 'serial'].includes(r.transport)) return { ok: false, code: 'E_TARGET', message: 'unknown transport' };
    const t = targetOf(r);
    if (!t.ok) return t;
    const summary = describe(r);
    if (!armed) return { ok: true, sent: false, summary };
    const min = r.transport === 'artnet' ? DMX_MIN_MS : MSG_MIN_MS;
    // DMX shares ONE budget per universe: a node's own address and a broadcast address reach the same
    // lights, so they must not have a budget each (release critic R4).
    const rateKey = r.transport === 'artnet' ? `artnet|${Number(r.universe)}` : t.key;
    const last = lastSent.get(rateKey) || 0;
    if (now - last < min) return { ok: false, code: 'E_RATE', message: r.transport === 'artnet' ? 'DMX is capped at 3 frames a second' : 'too many messages to this target' };
    lastSent.set(rateKey, now);
    try {
        if (r.transport === 'osc') await impl.udp(String(r.host), Number(r.port), encodeOsc(String(r.address), r.value));
        else if (r.transport === 'artnet') {
            // Recorded BEFORE the frame leaves, so a Panic pressed while it is in flight still blacks it out.
            dmxTargets.set(t.key, { host: String(r.host), port: Number(r.port), universe: Number(r.universe) });
            await impl.udp(String(r.host), Number(r.port), encodeArtDmx(Number(r.universe), dmxChannels(r.value)));
        } else if (r.transport === 'mqtt') await impl.mqtt(String(r.host), Number(r.port), String(r.topic), Buffer.from(asText(r.value), 'utf8'));
        else if (r.transport === 'serial') { /* allowed: the page writes the line through Web Serial */ }
        else if (r.transport === 'ws') await impl.ws(String(r.url), asText(r.value));
        else await impl.http(String(r.url), asText(r.value));
        return { ok: true, sent: true, summary };
    } catch (e) {
        return { ok: false, code: 'E_SEND', message: String((e as Error)?.message || e) };
    }
}

async function httpPost(url: string, body: string): Promise<void> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, redirect: 'manual', signal: ac.signal });
        if (res.status >= 400) throw new Error(`the device answered ${res.status}`);
    } finally { clearTimeout(timer); }
}

/** PANIC: disarm, then black out every DMX universe a graph lit, on the port it was lit through. */
export async function panic(deps: SendDeps = {}): Promise<{ ok: true; blackouts: number }> {
    armed = false;
    const u = { udp, ...(deps.transportImpl || {}) }.udp as typeof udp;
    let n = 0;
    for (const { host, port, universe } of dmxTargets.values()) {
        try { await u(host, port, encodeArtDmx(universe, new Uint8Array(512))); n++; } catch { /* keep going: black out the others */ }
    }
    return { ok: true, blackouts: n };
}

/** For tests: forget the rate and DMX memory. */
export function resetForTests(): void { armed = false; lastSent.clear(); dmxTargets.clear(); }
