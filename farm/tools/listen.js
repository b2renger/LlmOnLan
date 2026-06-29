// Manual discovery listener — proves the farm's UDP beacon + /lol/self work
// without the Electron shell. The shell's listener (M3 client half) mirrors this.
//
//   node tools/listen.js            # listen for beacons (Ctrl-C to stop)
//   node tools/listen.js <host>     # also probe http://<host>:<httpPort>/lol/self
//
// Env: LOL_GROUP (239.255.43.10), LOL_PORT (41998), LOL_HTTP_PORT (41997).

const dgram = require('dgram');
const http = require('http');
const os = require('os');

const GROUP = process.env.LOL_GROUP || '239.255.43.10';
const PORT = Number(process.env.LOL_PORT || 41998);
const HTTP_PORT = Number(process.env.LOL_HTTP_PORT || 41997);

function localIPv4s() {
    const out = [];
    for (const list of Object.values(os.networkInterfaces())) {
        for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
    return out;
}

function describe(snap, via) {
    const models = (snap.models || []).map((m) => m.id).join(', ');
    const h = snap.health || {};
    console.log(
        `● ${snap.name}  [${via}]\n` +
        `    id=${(snap.id || '').slice(0, 8)}  endpoint=${snap.openaiBaseUrl}\n` +
        `    models=${models}  healthy=${snap.healthy}  hostsUp=${h.hostsUp}/${h.hostsTotal}  loaded=${(h.loaded || []).join(',') || '-'}`
    );
}

// ---- UDP beacon listener ----
const seen = new Map();
const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
socket.on('message', (msg, rinfo) => {
    let snap;
    try { snap = JSON.parse(msg.toString()); } catch { return; }
    if (!snap || snap.v == null) return;
    const key = snap.id || rinfo.address;
    const first = !seen.has(key);
    seen.set(key, Date.now());
    if (first) describe(snap, `beacon from ${rinfo.address}`);
});
socket.bind(PORT, () => {
    try { socket.addMembership(GROUP); } catch { /* default join may fail */ }
    for (const ip of localIPv4s()) { try { socket.addMembership(GROUP, ip); } catch { /* already joined */ } }
    console.log(`listening for LOL beacons on ${GROUP}:${PORT} (+ broadcast). Ctrl-C to stop.`);
});

// ---- optional unicast probe ----
const host = process.argv[2];
if (host) {
    const req = http.get({ host, port: HTTP_PORT, path: '/lol/self', timeout: 2000 }, (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => { try { describe(JSON.parse(b), `/lol/self @ ${host}`); } catch { console.log(`/lol/self @ ${host}: bad response`); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', (e) => console.log(`/lol/self @ ${host}: ${e.message}`));
}
