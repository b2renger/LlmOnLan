// The message bus (docs/ECOSYSTEM_PLAN.md §8d, P3b): the farm as the LAN's meeting point, so a
// microcontroller and a Computer talk through it with zero setup. Three doors onto ONE in-memory topic
// space, so an ESP32 on MQTT, a browser on WebSocket and TouchDesigner on OSC see the same messages:
//   • an MQTT 3.1.1 broker (TCP, bus.mqttPort, default 1883);
//   • a WebSocket hub (RFC 6455, bus.wsPort, default 8893): {"sub"}, {"unsub"}, {"pub","data"} in,
//     {"topic","data"} out, {"subscribed"} / {"error"} as answers; GET /health is the farm's probe;
//   • an OSC relay (UDP, bus.oscPort, default 9001): "/light 0.5" is published on osc/light, and
//     "/lol/listen <filter> [password] [reply port]" sends every matching message back as OSC (to the
//     sending port, or the reply port) for 10 minutes; "/lol/unlisten [filter] [reply port]" stops it.
// Payloads: MQTT carries bytes, WebSocket and OSC carry values. A payload that parses as JSON is that
// value, anything else is its text; a value goes to MQTT as its JSON text, except a string, which goes as
// itself (a board reading "on" should not have to strip quotes). Every door delivers to every matching
// subscriber, the sender included (MQTT 3.1.1 has no "no local").
//
// Node's standard library only: the Farm app ships farm/ as-is. The plugin registry runs this file as its
// own process (process.execPath + an IPC channel): a parser bug or a flood never reaches the seat gate or
// the beacon, it gets a pid `lol down` can stop, and it exits when the farm's process goes away.
//
// Auth follows the farm password (config.proxy.masterKey; the farm sends a changed one over IPC):
// MQTT username "lol" + the password, WebSocket ?key=<password>, OSC /lol/listen's second argument. An
// open farm asks for nothing. Messages are never logged — a person's data — only counts and refusals.

const net = require('net');
const http = require('http');
const dgram = require('dgram');
const crypto = require('crypto');
const { fork } = require('child_process');
const { serviceHosts } = require('./net');

const MAX_CLIENTS = 256;             // per door: MQTT connections, WebSocket connections, OSC listeners
const MAX_PACKET = 64 * 1024;        // an MQTT packet, a WebSocket message
const MAX_RATE = 200;                // messages per second per client; beyond, dropped (said once)
const MAX_FILTERS = 64;              // subscriptions per client
const OSC_LISTEN_MS = 10 * 60 * 1000;
const CONNECT_MS = 10000;            // a TCP client that has not sent CONNECT by then is dropped
const SLOW_BYTES = 1 << 20;          // a subscriber this far behind loses messages instead of growing memory
const REFUSE_DELAY_MS = 400;         // a wrong password costs time (as /lol/plugin-keys)
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ---- topics (MQTT 3.1.1 §4.7) ----------------------------------------------------------------------

function validTopic(t) {
    return typeof t === 'string' && t.length > 0 && Buffer.byteLength(t) <= 65535 && !/[+#\u0000]/.test(t);
}
// '+' is a whole level, '#' a whole LAST level.
function validFilter(f) {
    if (typeof f !== 'string' || !f.length || Buffer.byteLength(f) > 65535 || f.includes('\u0000')) return false;
    const lv = f.split('/');
    return lv.every((l, i) => (l === '#' ? i === lv.length - 1 : l === '+' || !/[+#]/.test(l)));
}
// '+' matches one level, '#' the rest AND the parent ('a/#' matches 'a'); '$' topics stay out of wildcards.
function topicMatches(filter, topic) {
    if (topic[0] === '$' && (filter[0] === '+' || filter[0] === '#')) return false;
    const f = filter.split('/');
    const t = topic.split('/');
    for (let i = 0; i < f.length; i++) {
        if (f[i] === '#') return true;
        if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) return false;
    }
    return f.length === t.length;
}

function toData(payload) {
    const s = payload.toString('utf8');
    try { return JSON.parse(s); } catch { return s; }
}
function toPayload(data) {
    return Buffer.from(typeof data === 'string' ? data : JSON.stringify(data === undefined ? null : data));
}

// ---- wire formats ----------------------------------------------------------------------------------

function mqttPacket(first, body) {
    const len = [];
    let n = body.length;
    do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; len.push(b); } while (n > 0);
    return Buffer.concat([Buffer.from([first, ...len]), body]);
}
function mqttPublish(topic, payload) {
    const t = Buffer.from(topic);
    return mqttPacket(0x30, Buffer.concat([Buffer.from([t.length >> 8, t.length & 255]), t, payload]));
}
// A bounds-checked reader over one MQTT packet body: a short packet throws, and the caller drops the socket.
function reader(buf) {
    let o = 0;
    const need = (n) => { if (o + n > buf.length) throw new Error('short packet'); };
    const r = {
        u8: () => { need(1); return buf[o++]; },
        u16: () => { need(2); const v = buf.readUInt16BE(o); o += 2; return v; },
        bytes: () => { const n = r.u16(); need(n); const v = buf.subarray(o, o + n); o += n; return v; },
        str: () => r.bytes().toString('utf8'),
        rest: () => buf.subarray(o),
        more: () => o < buf.length,
    };
    return r;
}

function wsFrame(op, payload) {
    const n = payload.length;
    let head;
    if (n < 126) head = Buffer.from([0x80 | op, n]);
    else if (n < 65536) head = Buffer.from([0x80 | op, 126, n >> 8, n & 255]);
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(Math.floor(n / 2 ** 32), 2); head.writeUInt32BE(n >>> 0, 6); }
    return Buffer.concat([head, payload]);
}

function oscString(s) {
    const b = Buffer.from(String(s) + '\0');
    return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}
// A value as OSC arguments: number → i (an int32) or f, string → s, bool → T/F, array → its items, null →
// no argument; anything else (an object, a nested array) → its JSON text as s.
function oscEncode(address, data) {
    const items = data === null || data === undefined ? [] : Array.isArray(data) ? data : [data];
    let tags = ',';
    const parts = [];
    for (const v of items) {
        if (v === true) tags += 'T';
        else if (v === false) tags += 'F';
        else if (typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) {
            tags += 'i'; const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b);
        } else if (typeof v === 'number') {
            tags += 'f'; const b = Buffer.alloc(4); b.writeFloatBE(v); parts.push(b);
        } else { tags += 's'; parts.push(oscString(typeof v === 'string' ? v : JSON.stringify(v))); }
    }
    return Buffer.concat([oscString(address), oscString(tags), ...parts]);
}
// One OSC packet → [{ address, args }] (a bundle gives its messages). Types i f d s T F N; anything else
// throws and the packet is ignored. A float32 comes back rounded to its 7 digits (0.1, not 0.10000000149).
function oscDecode(buf, depth = 0) {
    let o = 0;
    const str = () => {
        const end = buf.indexOf(0, o);
        if (end < 0) throw new Error('unterminated OSC string');
        const s = buf.toString('utf8', o, end);
        o = (end + 4) & ~3;
        return s;
    };
    const address = str();
    if (address === '#bundle') {
        // ponytail: a bundle's time tag is ignored, every element is relayed at once; upgrade path: hold
        // future-dated elements on a timer if a show ever needs scheduled cues.
        if (depth > 4) throw new Error('bundle nested too deep');
        o += 8;
        const out = [];
        while (o + 4 <= buf.length) {
            const n = buf.readInt32BE(o);
            o += 4;
            if (n <= 0 || o + n > buf.length) throw new Error('bad bundle element');
            out.push(...oscDecode(buf.subarray(o, o + n), depth + 1));
            o += n;
        }
        return out;
    }
    if (address[0] !== '/') throw new Error('not an OSC address');
    const args = [];
    if (o < buf.length && buf[o] === 0x2c) {   // ',' — the type tags (OSC 1.0 lets old senders omit them)
        for (const t of str().slice(1)) {
            if (t === 'i') { args.push(buf.readInt32BE(o)); o += 4; }
            else if (t === 'f') { args.push(parseFloat(buf.readFloatBE(o).toPrecision(7))); o += 4; }
            else if (t === 'd') { args.push(buf.readDoubleBE(o)); o += 8; }
            else if (t === 's') args.push(str());
            else if (t === 'T') args.push(true);
            else if (t === 'F') args.push(false);
            else if (t === 'N') args.push(null);
            else throw new Error(`unsupported OSC type ${t}`);
        }
    }
    return [{ address, args }];
}

// ---- the bus -------------------------------------------------------------------------------------

// Starts the three doors. Resolves `ready` with the bound ports (port 0 = any, for tests). `log` gets
// one line per event worth an operator's eye — never a message.
function startBus({ host = '0.0.0.0', mqttPort = 1883, wsPort = 8893, oscPort = 9001, key = null, log = console.log } = {}) {
    let password = key || null;
    let isReady = false;
    const subscribers = new Set();     // anything that receives: { filters: Set, send(msg) }
    const mqttConns = new Set();       // every MQTT socket's client, connected or not yet
    const mqttIds = new Map();         // client id → client
    const wsConns = new Set();
    const oscListeners = new Map();    // "ip:port" → listener
    const oscRates = new Map();        // "ip:port" → rate state of an OSC sender
    const stats = { messages: 0, delivered: 0, dropped: 0 };
    const said = new Set();            // one-time log lines (a cap, a refusal per address)
    const once = (k, line) => { if (said.size < 4096 && !said.has(k)) { said.add(k); log(line); } };

    const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
    const keyOk = (given) => !password || (typeof given === 'string' && crypto.timingSafeEqual(sha(given), sha(password)));
    const refused = (door, ip) => once(`refused ${door} ${ip}`, `${door}: refused ${ip} (wrong or missing farm password; said once per address)`);

    function rateOk(c, who) {
        const now = Date.now();
        if (now - (c.winStart || 0) >= 1000) { c.winStart = now; c.count = 0; }
        if (++c.count <= MAX_RATE) return true;
        stats.dropped++;
        if (!c.warned) { c.warned = true; log(`${who} sent over ${MAX_RATE} messages/s — dropping the excess (said once)`); }
        return false;
    }

    function publish(topic, payload) {
        stats.messages++;
        let data; let parsed = false;
        const msg = { topic, payload, data: () => (parsed ? data : (parsed = true, data = toData(payload))) };
        for (const s of subscribers) {
            for (const f of s.filters) {
                if (topicMatches(f, topic)) {
                    try { s.send(msg); stats.delivered++; } catch { stats.dropped++; }   // one broken subscriber never stops the rest
                    break;
                }
            }
        }
    }
    // A TCP subscriber that stopped reading keeps its socket but loses messages.
    const writeOr = (socket, make) => { if (socket.writableLength < SLOW_BYTES) socket.write(make()); else stats.dropped++; };

    // ---- MQTT ----
    const mqtt = net.createServer((socket) => {
        const c = { socket, ip: socket.remoteAddress, id: null, connected: false, refused: false, filters: new Set(), buf: Buffer.alloc(0), openedAt: Date.now(), lastSeen: Date.now(), keepAliveMs: 0 };
        c.send = (msg) => writeOr(socket, () => msg.mqtt || (msg.mqtt = mqttPublish(msg.topic, msg.payload)));
        mqttConns.add(c);
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 30000);        // a board that asked for no MQTT keep-alive is still found by TCP
        socket.on('data', (chunk) => { try { onMqttData(c, chunk); } catch { socket.destroy(); } });
        socket.on('error', () => { /* a reset board: 'close' cleans up */ });
        socket.on('close', () => {
            mqttConns.delete(c);
            subscribers.delete(c);
            if (c.id != null && mqttIds.get(c.id) === c) mqttIds.delete(c.id);
        });
    });
    mqtt.maxConnections = MAX_CLIENTS;
    mqtt.on('drop', () => once('cap mqtt', `MQTT: ${MAX_CLIENTS} connections — refusing more (said once)`));

    function onMqttData(c, chunk) {
        if (c.refused) return;
        c.buf = c.buf.length ? Buffer.concat([c.buf, chunk]) : chunk;
        c.lastSeen = Date.now();
        for (;;) {
            const b = c.buf;
            if (b.length < 2) return;
            let len = 0; let mult = 1; let i = 1;
            for (;;) {                                   // the remaining length: 1..4 bytes, maybe split across chunks
                if (i >= b.length) return;
                const byte = b[i++];
                len += (byte & 127) * mult;
                if (!(byte & 128)) break;
                mult *= 128;
                if (i > 4) throw new Error('bad remaining length');
            }
            if (len > MAX_PACKET) throw new Error('packet over the cap');
            if (b.length < i + len) return;
            c.buf = b.subarray(i + len);
            onMqttPacket(c, b[0] >> 4, b[0] & 15, b.subarray(i, i + len));
            if (c.refused || c.socket.destroyed) return;
        }
    }

    function onMqttPacket(c, type, flags, body) {
        const r = reader(body);
        const ack = (first, pid) => c.socket.write(Buffer.from([first, 2, pid >> 8, pid & 255]));
        if (!c.connected) {
            if (type !== 1) throw new Error('the first packet must be CONNECT');
            return onConnect(c, r);
        }
        switch (type) {
            case 3: {                                    // PUBLISH
                const qos = (flags >> 1) & 3;
                if (qos === 3) throw new Error('bad QoS');
                const topic = r.str();
                const pid = qos ? r.u16() : 0;
                if (!validTopic(topic)) throw new Error('bad topic');
                // Accepted at any QoS, delivered at QoS 0. QoS 2 gets its PUBREC/PUBCOMP so a client that
                // asks for it does not hang, but no exactly-once (a re-sent PUBLISH is delivered again).
                // ponytail: the retain flag is ignored (no retained messages): a late subscriber waits for
                // the next message; upgrade path: keep the last retained payload per topic, send it on SUBSCRIBE.
                if (qos === 1) ack(0x40, pid);
                if (qos === 2) ack(0x50, pid);
                if (rateOk(c, `MQTT client ${c.ip}`)) publish(topic, r.rest());
                return;
            }
            case 6: return ack(0x70, r.u16());          // PUBREL → PUBCOMP
            case 8: {                                    // SUBSCRIBE → SUBACK, everything granted at QoS 0
                if (flags !== 2) throw new Error('bad SUBSCRIBE flags');
                const pid = r.u16();
                const codes = [];
                while (r.more()) {
                    const f = r.str();
                    r.u8();                              // the requested QoS
                    const ok = validFilter(f) && (c.filters.has(f) || c.filters.size < MAX_FILTERS);
                    if (ok) c.filters.add(f);
                    codes.push(ok ? 0 : 0x80);
                }
                if (!codes.length) throw new Error('empty SUBSCRIBE');
                return c.socket.write(mqttPacket(0x90, Buffer.from([pid >> 8, pid & 255, ...codes])));
            }
            case 10: {                                   // UNSUBSCRIBE → UNSUBACK
                if (flags !== 2) throw new Error('bad UNSUBSCRIBE flags');
                const pid = r.u16();
                while (r.more()) c.filters.delete(r.str());
                return ack(0xb0, pid);
            }
            case 12: return c.socket.write(Buffer.from([0xd0, 0]));   // PINGREQ → PINGRESP
            case 14: return c.socket.end();                            // DISCONNECT
            case 4: case 5: case 7: return;              // acks of QoS > 0 deliveries, which we never send
            default: throw new Error('unexpected packet');
        }
    }

    function onConnect(c, r) {
        const proto = r.str();
        const level = r.u8();
        const flags = r.u8();
        const keepAlive = r.u16();
        if (proto !== 'MQTT' && proto !== 'MQIsdp') throw new Error('not MQTT');
        const refuse = (code, delay) => {
            c.refused = true;
            setTimeout(() => { if (!c.socket.destroyed) c.socket.end(Buffer.from([0x20, 2, 0, code])); }, delay);
        };
        if (level !== 4 && level !== 3) return refuse(1, 0);          // CONNACK 1: unacceptable protocol version
        let id = r.str();
        // ponytail: a will is read and ignored (no will messages); upgrade path: keep it on the client and
        // publish it from 'close' when no DISCONNECT came first.
        if (flags & 0x04) { r.str(); r.bytes(); }
        const user = (flags & 0x80) ? r.str() : null;
        const pass = (flags & 0x40) ? r.bytes().toString('utf8') : null;
        if (password && !(user === 'lol' && keyOk(pass))) {
            refused('MQTT', c.ip);
            return refuse(5, REFUSE_DELAY_MS);                          // CONNACK 5: not authorized
        }
        // ponytail: every session is clean (no persistence: subscriptions and QoS 1 messages in flight
        // die with the connection, so a board subscribes again after each connect, as PubSubClient
        // sketches do); upgrade path: keep a client id's filters for a while after it leaves.
        if (!id) id = `lol-${crypto.randomBytes(6).toString('hex')}`;
        const old = mqttIds.get(id);
        if (old) old.socket.destroy();          // the same id again = the board reconnected; its old session ends (§3.1.4)
        mqttIds.set(id, c);
        c.id = id;
        c.connected = true;
        c.keepAliveMs = keepAlive * 1000;
        subscribers.add(c);
        c.socket.write(Buffer.from([0x20, 2, 0, 0]));
    }

    // ---- WebSocket ----
    const httpServer = http.createServer((req, res) => {
        if (/^\/health(\?|$)/.test(req.url)) {
            res.writeHead(isReady ? 200 : 503, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ bus: true, ready: isReady, mqtt: mqttIds.size, ws: wsConns.size, osc: oscListeners.size, ...stats }));
        }
        res.writeHead(426, { 'Content-Type': 'text/plain', Upgrade: 'websocket' });
        res.end('The LlmOnLan message bus: connect with a WebSocket.\n');
    });
    httpServer.on('upgrade', (req, socket, head) => {
        socket.on('error', () => { /* 'close' cleans up */ });
        const ip = socket.remoteAddress;
        const reject = (status) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        const wsKey = req.headers['sec-websocket-key'];
        if (String(req.headers.upgrade).toLowerCase() !== 'websocket' || !wsKey || req.headers['sec-websocket-version'] !== '13') return reject('400 Bad Request');
        if (wsConns.size >= MAX_CLIENTS) { once('cap ws', `WebSocket: ${MAX_CLIENTS} connections — refusing more (said once)`); return reject('503 Service Unavailable'); }
        let given = null;
        try { given = new URL(req.url, 'http://bus').searchParams.get('key'); } catch { /* no key */ }
        if (!keyOk(given)) {
            refused('WebSocket', ip);
            return setTimeout(() => reject('401 Unauthorized'), REFUSE_DELAY_MS);
        }
        const accept = crypto.createHash('sha1').update(wsKey + WS_GUID).digest('base64');
        socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
        socket.setNoDelay(true);
        socket.setKeepAlive(true, 30000);        // a laptop that went to sleep is found by TCP, not by us
        const c = { socket, ip, filters: new Set(), buf: Buffer.alloc(0), frag: null, fragLen: 0, closed: false };
        c.send = (msg) => { if (!c.closed) writeOr(socket, () => msg.ws || (msg.ws = wsFrame(1, Buffer.from(JSON.stringify({ topic: msg.topic, data: msg.data() }))))); };
        wsConns.add(c);
        subscribers.add(c);
        const feed = (chunk) => { try { onWsData(c, chunk); } catch { socket.destroy(); } };
        socket.on('data', feed);
        socket.on('close', () => { wsConns.delete(c); subscribers.delete(c); });
        if (head && head.length) feed(head);
    });

    function wsClose(c, code) {
        if (c.closed) return;
        c.closed = true;
        c.socket.end(wsFrame(8, Buffer.from([code >> 8, code & 255])));
    }
    const wsJson = (c, obj) => writeOr(c.socket, () => wsFrame(1, Buffer.from(JSON.stringify(obj))));

    function onWsData(c, chunk) {
        if (c.closed) return;
        c.buf = c.buf.length ? Buffer.concat([c.buf, chunk]) : chunk;
        for (;;) {
            const b = c.buf;
            if (b.length < 2) return;
            if (b[0] & 0x70) return wsClose(c, 1002);            // no extension was negotiated
            if (!(b[1] & 0x80)) return wsClose(c, 1002);         // a client MUST mask (RFC 6455 §5.1)
            let len = b[1] & 0x7f;
            let o = 2;
            if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); o = 4; }
            else if (len === 127) { if (b.length < 10) return; len = b.readUInt32BE(2) ? Infinity : b.readUInt32BE(6); o = 10; }
            if (len > MAX_PACKET) return wsClose(c, 1009);
            if (b.length < o + 4 + len) return;
            const mask = b.subarray(o, o + 4);
            const data = Buffer.from(b.subarray(o + 4, o + 4 + len));
            for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
            c.buf = b.subarray(o + 4 + len);
            onWsFrame(c, !!(b[0] & 0x80), b[0] & 0x0f, data);
            if (c.closed) return;
        }
    }

    function onWsFrame(c, fin, op, data) {
        if (op >= 8) {                                            // control: never fragmented, ≤ 125 bytes
            if (!fin || data.length > 125) return wsClose(c, 1002);
            if (op === 8) return wsClose(c, 1000);
            if (op === 9) return writeOr(c.socket, () => wsFrame(0xa, data));   // ping → pong
            return;                                               // pong
        }
        if (op === 0) {
            if (!c.frag) return wsClose(c, 1002);
            c.frag.push(data);
        } else if (op === 1 || op === 2) {                        // binary is read as UTF-8 text too
            if (c.frag) return wsClose(c, 1002);
            c.frag = [data];
            c.fragLen = 0;
        } else return wsClose(c, 1002);
        c.fragLen += data.length;
        if (c.fragLen > MAX_PACKET) return wsClose(c, 1009);
        if (!fin) return;
        const text = Buffer.concat(c.frag).toString('utf8');
        c.frag = null;
        onWsMessage(c, text);
    }

    function onWsMessage(c, text) {
        if (!rateOk(c, `WebSocket client ${c.ip}`)) return;
        let m = null;
        try { m = JSON.parse(text); } catch { /* answered below */ }
        if (!m || typeof m !== 'object' || Array.isArray(m)) return wsJson(c, { error: 'send {"sub": filter}, {"unsub": filter} or {"pub": topic, "data": value}' });
        if ('sub' in m) {
            if (validFilter(m.sub) && (c.filters.has(m.sub) || c.filters.size < MAX_FILTERS)) {
                c.filters.add(m.sub);
                wsJson(c, { subscribed: m.sub });
            } else wsJson(c, { error: `cannot subscribe: a filter is a topic with + for one level or # for the rest (at most ${MAX_FILTERS})` });
        }
        if ('unsub' in m) c.filters.delete(m.unsub);
        if ('pub' in m) {
            if (validTopic(m.pub)) publish(m.pub, toPayload(m.data));
            else wsJson(c, { error: 'cannot publish: a topic is not empty and has no + or #' });
        }
    }

    // ---- OSC ----
    const osc = dgram.createSocket('udp4');
    osc.on('message', (buf, rinfo) => {
        let msgs;
        try { msgs = oscDecode(buf); } catch { return; }          // not OSC, or a type we do not read: ignored
        const who = `${rinfo.address}:${rinfo.port}`;
        let rate = oscRates.get(who);
        if (!rate) {
            if (oscRates.size >= 4096) oscRates.clear();
            oscRates.set(who, rate = {});
        }
        for (const m of msgs) { if (rateOk(rate, `OSC sender ${who}`)) onOsc(m, rinfo); }
    });

    const oscSend = (buf, rinfo) => { try { osc.send(buf, rinfo.port, rinfo.address, () => {}); } catch { /* the relay is closing */ } };

    function onOsc(m, rinfo) {
        if (m.address === '/lol/listen' || m.address === '/lol/unlisten') {
            // An integer argument is a reply port: the messages go to this address at that port instead of
            // back to the sending port (TouchDesigner and Max send from one port and listen on another).
            const replyPort = m.args.find((a) => Number.isInteger(a) && a > 0 && a < 65536);
            const to = { address: rinfo.address, port: replyPort || rinfo.port };
            const at = `${to.address}:${to.port}`;
            const filter = typeof m.args[0] === 'string' && m.args[0] ? m.args[0] : null;
            let l = oscListeners.get(at);
            if (m.address === '/lol/unlisten') {
                if (!l) return;
                if (filter) l.filters.delete(filter); else l.filters.clear();
                if (!l.filters.size) { oscListeners.delete(at); subscribers.delete(l); }
                return;
            }
            if (!validFilter(filter)) return;
            if (!keyOk(m.args[1])) return refused('OSC', rinfo.address);
            if (!l) {
                if (oscListeners.size >= MAX_CLIENTS) return once('cap osc', `OSC: ${MAX_CLIENTS} listeners — refusing more (said once)`);
                l = { filters: new Set(), expires: 0 };
                l.send = (msg) => oscSend(msg.osc || (msg.osc = oscEncode(`/${msg.topic}`, msg.data())), to);
                oscListeners.set(at, l);
                subscribers.add(l);
            }
            if (l.filters.has(filter) || l.filters.size < MAX_FILTERS) l.filters.add(filter);
            l.expires = Date.now() + OSC_LISTEN_MS;
            oscSend(oscEncode('/lol/listening', filter), to);   // the answer a person can see in their OSC tool
            return;
        }
        if (m.address.startsWith('/lol/')) return;                // the relay's own commands
        // ponytail: on a keyed farm an OSC sender needs no password to WRITE (ordinary OSC tools cannot log
        // in), but only under osc/…; reading anything needs /lol/listen with the password. Upgrade path:
        // accept writes only from an address that listened with the password in the last 10 minutes.
        const topic = `osc/${m.address.slice(1)}`;
        if (validTopic(topic)) publish(topic, toPayload(m.args.length === 1 ? m.args[0] : m.args.length ? m.args : null));
    }

    // ---- the sweep: keep-alive, CONNECT timeout, OSC listener expiry ----
    const sweep = setInterval(() => {
        const now = Date.now();
        for (const c of mqttConns) {
            const late = c.connected
                ? c.keepAliveMs > 0 && now - c.lastSeen > c.keepAliveMs * 1.5
                : now - c.openedAt > CONNECT_MS;
            if (late) c.socket.destroy();
        }
        for (const [who, l] of oscListeners) {
            if (now > l.expires) { oscListeners.delete(who); subscribers.delete(l); }
        }
    }, 1000);
    if (sweep.unref) sweep.unref();

    // A new farm password: sessions opened with the old one end, and reconnect with the new one.
    function setKey(k) {
        k = k || null;
        if (k === password) return;
        password = k;
        if (password) {
            for (const c of mqttConns) c.socket.destroy();
            for (const c of wsConns) c.socket.destroy();
            for (const l of oscListeners.values()) subscribers.delete(l);
            oscListeners.clear();
        }
        log(password ? 'the farm password changed — every session was closed and must connect with the new one' : 'the farm password was removed — the bus is open');
    }

    const listen = (server, port) => new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(); });
    });
    const ready = Promise.all([
        listen(mqtt, mqttPort),
        listen(httpServer, wsPort),
        new Promise((resolve, reject) => {
            osc.once('error', reject);
            osc.bind(oscPort, host, () => { osc.off('error', reject); resolve(); });
        }),
    ]).then(() => {
        isReady = true;
        // Windows reports an ICMP "port unreachable" from a listener that went away as a receive error.
        osc.on('error', (e) => once(`osc error ${e.code}`, `OSC: ${e.code || e.message} (said once)`));
        return { mqtt: mqtt.address().port, ws: httpServer.address().port, osc: osc.address().port };
    });

    function close() {
        clearInterval(sweep);
        for (const c of mqttConns) c.socket.destroy();
        for (const c of wsConns) c.socket.destroy();
        if (httpServer.closeAllConnections) httpServer.closeAllConnections();
        return Promise.all([
            new Promise((r) => mqtt.close(() => r())),
            new Promise((r) => httpServer.close(() => r())),
            new Promise((r) => { try { osc.close(() => r()); } catch { r(); } }),
        ]);
    }

    return { ready, close, setKey, stats, counts: () => ({ mqtt: mqttIds.size, ws: wsConns.size, osc: oscListeners.size }) };
}

// ---- the farm's side: run it as a child, probe it, hand it a new password ---------------------------

// fork = process.execPath (plain Node, or the Farm app's Electron with ELECTRON_RUN_AS_NODE inherited) +
// an IPC channel. The password rides in the env for the first start, so the bus is never open a moment.
function spawnBus(config, ctx, forkFn = fork) {
    return forkFn(__filename, [], {
        execArgv: [],
        windowsHide: true,
        detached: process.platform !== 'win32',
        env: {
            ...process.env,
            LOL_BUS_HOST: serviceHosts(config.proxy && config.proxy.host).bind,
            LOL_BUS_MQTT_PORT: String(config.bus.mqttPort),
            LOL_BUS_WS_PORT: String(config.bus.wsPort),
            LOL_BUS_OSC_PORT: String(config.bus.oscPort),
            LOL_BUS_KEY: (ctx && ctx.key) || '',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
}

// The health tick's call: the child ignores an unchanged password.
function sendKey(child, key) {
    try { if (child && child.connected) child.send({ key: key || null }); } catch { /* the bus is going away */ }
}

async function busAlive(port, host = '127.0.0.1') {
    try {
        const r = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(2000) });
        return r.status === 200 && (await r.json()).bus === true;
    } catch { return false; }
}

async function waitForBus(port, timeoutMs = 15000, host = '127.0.0.1', isDead = () => false) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (isDead()) return false;
        if (await busAlive(port, host)) return true;
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

if (require.main === module) {
    const env = process.env;
    const key = env.LOL_BUS_KEY || null;
    delete env.LOL_BUS_KEY;
    const bus = startBus({
        host: env.LOL_BUS_HOST || '0.0.0.0',
        mqttPort: Number(env.LOL_BUS_MQTT_PORT) || 1883,
        wsPort: Number(env.LOL_BUS_WS_PORT) || 8893,
        oscPort: Number(env.LOL_BUS_OSC_PORT) || 9001,
        key,
    });
    bus.ready.then(
        (p) => console.log(`listening — MQTT ${p.mqtt} · WebSocket ${p.ws} · OSC ${p.osc} (udp) · ${key ? 'the farm password is required' : 'open (no farm password)'}`),
        (e) => { console.error(`cannot listen: ${e.message}`); process.exit(1); },
    );
    process.on('message', (m) => { if (m && typeof m === 'object' && 'key' in m) bus.setKey(m.key); });
    process.on('disconnect', () => process.exit(0));   // the farm's process is gone: give the ports back
}

module.exports = {
    startBus, spawnBus, sendKey, busAlive, waitForBus,
    topicMatches, validTopic, validFilter, toData, toPayload, oscEncode, oscDecode, mqttPacket,
    MAX_CLIENTS, MAX_PACKET, MAX_RATE,
};
