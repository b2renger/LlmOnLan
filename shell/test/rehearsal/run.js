// CLASS_REHEARSAL_PLAN step 1 (approved by the owner, 2026-11-18): a class rehearsed on this computer. Two scratch farms,
// N clients without windows (client.cjs: the client's compiled discovery, farm choice and Open WebUI supervisor), fresh
// first starts, a Wi-Fi that loses one farm for a while. Reports, per client: farm moves, every Open WebUI state, whether
// it ever said "keeps exiting", the time to Open WebUI ready and to a first answered chat.
//
//   node test/rehearsal/run.js [--clients 2] [--minutes 6] [--outage 20/40]     (from shell/, after npm run build)
//
// Sealed on 127.0.0.1: the farms' beacons are OFF; a relay here reads each farm's /lol/self and sends it to each client by
// UDP unicast to 127.0.0.1 on the client's own rehearsal port (LOL_FED_PORT 42101+, group 239.255.43.99, never the
// office's 239.255.43.10:41998); the relayed snapshot points the client's polls at a lossy proxy here, so an outage
// silences a farm's beacons AND the client's polls of it, as a Wi-Fi does. Before any client starts, a listener on the
// office group checks it hears nothing of the rehearsal; at the end every connection a client opened is listed.
// Needs: the released Open WebUI sidecar unpacked (REH_SIDECAR, a folder with python/ and launcher.py: `gh release download
// v0.2.19 -R b2renger/LlmOnLan -p owui-sidecar-win32-x64.tar.gz`, 771 MB, then `tar -xzf` it), `ollama` on PATH
// (run on 127.0.0.1:11500 with a scratch models folder, never the Ollama app's), the farm's venv (farm/.venv).
//
// Step 3, the slowness with ten and twenty (night n° 10):
//   --farm <its /lol/self port>  one farm already running (a scratch farm on a real model, started and stopped by hand,
//                                beacons off): no farm of the rehearsal's own, no outage; the clients all choose it.
//   --seats                      each client reaches the farm's gate from its own address, 127.0.0.(10+i), through a
//                                relay here, as laptops do (the gate gives one seat per address): its snapshots point it
//                                at that relay. Without it every client is 127.0.0.1, one seat.
//   --bursts R                   once every client is ready: R rounds of everyone asking at once, first straight to the
//                                gate through the client's relay (A), then through each client's own Open WebUI (B), the
//                                same question; per person the first token, the first word of the answer, words a second.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const { spawn, execFileSync, spawnSync } = require('child_process');

const SHELL = path.join(__dirname, '..', '..');
const REPO = path.join(SHELL, '..');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const CLIENTS = Number(arg('--clients', '2'));
const MINUTES = Number(arg('--minutes', '6'));
const [OUT_ON, OUT_OFF] = String(arg('--outage', '20/40')).split('/').map(Number);   // farm A silent ON s every ON+OFF s
const SIDECAR = process.env.REH_SIDECAR;
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-rehearsal-'));
const EXTERNAL = arg('--farm', null) == null ? null : Number(arg('--farm'));
const SEATS = process.argv.includes('--seats');
const BURSTS = Number(arg('--bursts', '0'));
// --no-think: the rounds ask with thinking off (Qwen3's chat_template_kwargs), to compare with the default people chat on.
const THINK = !process.argv.includes('--no-think');
// --slow-start K: a slow laptop's first start. Every Open WebUI process of the clients is held to CPU 0, beside K busy
// loops of the rehearsal's own on CPU 0 at the same priority, so it gets about 1/(K+1) of one core: its ~72 migrations
// then take minutes, as on the class's slowest Mac (137 s), and a farm switch (--blip) lands inside them. Nothing of
// Open WebUI or the client changes; the busy loops stop with the rehearsal.
const SLOW = arg('--slow-start', null) == null ? 0 : Number(arg('--slow-start'));
const PROMPT = 'Explain photosynthesis to a 12-year-old, in about 250 words.';
// Room for the whole answer: with thinking on (as people chat) Qwen3.6 thinks ~1,000 words on this question first, and
// 1,500 tokens cut most answers before their first word (night n° 10's first run).
const MAX_TOKENS = 8000;
let MODEL = 'qwen3:0.6b';
const OLLAMA = 'http://127.0.0.1:11500';
const GROUP = '239.255.43.99';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = (url, ms = 1500) => new Promise((res) => {
    const req = http.get(url, { timeout: ms }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => { try { res(JSON.parse(b)); } catch { res(null); } }); });
    req.on('timeout', () => req.destroy()); req.on('error', () => res(null));
});
const children = [];
const own = (c) => { children.push(c); return c; };

const FARMS = EXTERNAL ? [{ key: 'A', name: 'the farm on --farm', http: EXTERNAL, lossy: 41981, external: true }] : [
    { key: 'A', name: 'Rehearsal farm A (lossy)', proxy: 4390, http: 41991, lossy: 41981, code: path.join(REPO, 'farm') },
    { key: 'B', name: 'Rehearsal farm B', proxy: 4392, http: 41993, lossy: 41983, code: path.join(ROOT, 'farmB-code') },
];
// --seats: client i's own ports for farm f, its /lol/self polls and its gate relay, given by the system (a fixed 45000
// was taken once by something else on this computer).
const own_ports = new Map();
const lossyPort = (f, i) => (SEATS ? own_ports.get(`${f.key}${i}`).lossy : f.lossy);
const gatePort = (f, i) => own_ports.get(`${f.key}${i}`).gate;
const listen = (server, port) => new Promise((res, rej) => { server.once('error', rej); server.listen(port, '127.0.0.1', () => res(server.address().port)); });
const seatAddress = (i) => `127.0.0.${10 + i}`;
// What client i is told about farm f: on 127.0.0.1, its polls through its lossy proxy, its chats through its own relay.
const forClient = (f, s, i) => {
    const o = { ...say(f, loopback(s)), httpPort: lossyPort(f, i) };
    if (!SEATS) return o;
    const p = gatePort(f, i);
    return { ...o, proxyPort: p, endpoint: `http://127.0.0.1:${p}`, openaiBaseUrl: `http://127.0.0.1:${p}/v1` };
};
// The farms listen on 127.0.0.1 only: every address a snapshot advertises (its ips, endpoint, plugin urls) becomes it.
const loopback = (s) => { let j = JSON.stringify(s); for (const ip of s.ips || []) j = j.split(ip).join('127.0.0.1'); return { ...JSON.parse(j), ips: ['127.0.0.1'] }; };
// --blip S: farm A says it is unhealthy from S s after the clients launch, for 15 s (beacons and polls alike). A client
// leaves an unhealthy farm at once, so a blip a few seconds in lands inside Open WebUI's first start: the class's
// sequence (a farm switch killing a first start inside its migrations) without a slow computer.
const BLIP = arg('--blip', null) == null ? null : Number(arg('--blip', '6'));
let launchedAt = null;
const blipping = () => BLIP != null && launchedAt != null && Date.now() - launchedAt >= BLIP * 1000 && Date.now() - launchedAt < (BLIP + 15) * 1000;
const say = (f, s) => (f.key === 'A' && blipping() ? { ...s, healthy: false } : s);
const outage = () => { const p = ((Date.now() - t0) / 1000) % (OUT_ON + OUT_OFF); return p >= OUT_OFF; };   // A is silent here

// Step 3. Client r's Open WebUI, signed in: with WEBUI_AUTH false (the client's setting) Open WebUI signs everyone in
// as its one local user. Its model list says the farm's model under the name Open WebUI gives it.
async function signIn(r) {
    const ready = [...r.events].reverse().find((e) => e.kind === 'owui' && e.status === 'ready' && e.url);
    if (!ready) return { error: 'no Open WebUI ready' };
    const url = ready.url.replace(/\/+$/, '');
    try {
        const s = await fetch(`${url}/api/v1/auths/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@localhost', password: 'admin' }) });
        const token = s.ok ? (await s.json()).token : null;
        if (!token) return { url, error: `sign-in ${s.status}` };
        const m = await (await fetch(`${url}/api/models`, { headers: { authorization: `Bearer ${token}` } })).json();
        const ids = (m.data || []).map((x) => x.id);
        return { url, token, model: ids.includes(MODEL) ? MODEL : ids[0], models: ids };
    } catch (e) { return { url, error: String(e && e.message || e) }; }
}
// One streamed answer: ms to the first token (thinking or answer), to the first word of the answer, and words a second
// after the first token (thinking and answer words alike: what a person watches arrive).
async function streamOnce(url, headers, body) {
    const t = Date.now();
    const o = { firstTokenMs: null, firstAnswerMs: null, thinkingWords: 0, answerWords: 0, totalMs: null, error: null };
    let thinking = ''; let answer = '';
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) });
        if (!res.ok) { o.error = `${res.status} ${(await res.text()).slice(0, 160)}`; return o; }
        const dec = new TextDecoder(); let buf = '';
        for await (const chunk of res.body) {
            buf += dec.decode(chunk, { stream: true }); let k;
            while ((k = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
                if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
                let d; try { d = JSON.parse(line.slice(5)); } catch { continue; }
                const delta = d.choices && d.choices[0] && d.choices[0].delta || {};
                const th = delta.reasoning_content || delta.reasoning || ''; const an = delta.content || '';
                if ((th || an) && o.firstTokenMs == null) o.firstTokenMs = Date.now() - t;
                if (an && o.firstAnswerMs == null) o.firstAnswerMs = Date.now() - t;
                thinking += th; answer += an;
            }
        }
    } catch (e) { o.error = String(e && e.message || e); }
    o.totalMs = Date.now() - t;
    const words = (s) => (s.match(/\S+/g) || []).length;
    o.thinkingWords = words(thinking); o.answerWords = words(answer);
    o.wordsPerS = o.firstTokenMs == null ? null : +((o.thinkingWords + o.answerWords) / Math.max(0.001, (o.totalMs - o.firstTokenMs) / 1000)).toFixed(1);
    return o;
}
const pct = (xs, p) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const summarize = (per) => ({
    ok: per.filter((p) => !p.error).length, failed: per.filter((p) => p.error).map((p) => p.error),
    firstTokenS: { p50: pct(per.map((p) => p.firstTokenMs), 0.5) / 1000, max: pct(per.map((p) => p.firstTokenMs), 1) / 1000 },
    firstAnswerS: { p50: pct(per.map((p) => p.firstAnswerMs), 0.5) / 1000, max: pct(per.map((p) => p.firstAnswerMs), 1) / 1000 },
    wordsPerS: { p50: pct(per.map((p) => p.wordsPerS), 0.5), min: pct(per.map((p) => p.wordsPerS), 0) },
    answerWords: { p50: pct(per.map((p) => p.answerWords), 0.5) }, thinkingWords: { p50: pct(per.map((p) => p.thinkingWords), 0.5) },
});

async function main() {
    if (!SIDECAR || !fs.existsSync(path.join(SIDECAR, 'launcher.py'))) throw new Error('Set REH_SIDECAR to the released Open WebUI sidecar folder (python/, launcher.py).');
    log(`rehearsal in ${ROOT}: ${CLIENTS} clients, ${MINUTES} min, farm A silent ${OUT_ON} s every ${OUT_ON + OUT_OFF} s; Open WebUI ${fs.readFileSync(path.join(SIDECAR, 'OPENWEBUI_VERSION'), 'utf8').trim()}`);

    if (EXTERNAL) {
        const f = FARMS[0];
        f.snap = await getJson(`http://127.0.0.1:${f.http}/lol/self`, 5000);
        if (!f.snap) throw new Error(`no farm answers on 127.0.0.1:${f.http}`);
        f.proxy = f.snap.proxyPort;
        MODEL = (f.snap.models.find((m) => m.default) || f.snap.models[0]).id;
        log(`farm on --farm: ${f.snap.name}, gate ${f.proxy}, model ${MODEL} (${f.snap.backend && f.snap.backend.model}), ${f.snap.backend && f.snap.backend.slots} seats`);
    }
    // 1. The scratch Ollama (its own port and models folder), and the small model.
    if (!EXTERNAL && !(await getJson(`${OLLAMA}/api/version`))) {
        const models = path.join(ROOT, 'ollama-models'); fs.mkdirSync(models);
        own(spawn('ollama', ['serve'], { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11500', OLLAMA_MODELS: models }, stdio: 'ignore' }));
        for (let i = 0; i < 40 && !(await getJson(`${OLLAMA}/api/version`)); i++) await sleep(500);
        log('scratch Ollama on 11500, models in', models);
    }
    if (!EXTERNAL) spawnSync('ollama', ['pull', MODEL], { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11500' }, stdio: 'ignore' });

    // 2. Farm B's own copy of the farm code (its own id, runtime file and LiteLLM venv), without the big model folders.
    const skip = new Set(['.models', '.llamacpp', '.searxng', '.kokoro', '.extract', '.classify', '.stt', '.embed', '.lol-id', '.lol-secret', '.lol-runtime.json', 'lol.config.json', 'litellm']);
    if (!EXTERNAL) {
        fs.cpSync(FARMS[0].code, FARMS[1].code, { recursive: true, filter: (src) => !skip.has(path.basename(src)) || path.dirname(src) !== FARMS[0].code });
        fs.mkdirSync(path.join(FARMS[1].code, 'litellm'), { recursive: true });
    }

    // 3. The two farms: Ollama's small model, beacons off, plugins off, their own ports; each run from its own folder.
    for (const f of FARMS.filter((x) => !x.external)) {
        f.dir = path.join(ROOT, `farm${f.key}`); fs.mkdirSync(f.dir);
        fs.writeFileSync(path.join(f.dir, 'lol.config.json'), JSON.stringify({
            name: f.name, beacon: { enabled: false, httpPort: f.http }, proxy: { port: f.proxy, host: '127.0.0.1', internalPort: f.proxy + 1 },
            models: [{ id: MODEL, default: true }], preinstall: [], ollama: { hosts: [OLLAMA] },
            llamacpp: { enabled: false, port: 8195 + FARMS.indexOf(f) }, vllm: { enabled: false, root: '/home/nobody/lol-vllm-rehearsal-none', port: 8197 + FARMS.indexOf(f) },
            websearch: { enabled: false, port: 8980 + FARMS.indexOf(f) }, ocr: { enabled: false, port: 8982 + FARMS.indexOf(f) },
            tts: { enabled: false }, classify: { enabled: false }, stt: { enabled: false }, bus: { enabled: false }, embed: { enabled: false, port: 8984 + FARMS.indexOf(f) },
            admin: { token: `rehearsal-${f.key}` },
        }, null, 2));
        f.proc = own(spawn(process.execPath, [path.join(f.code, 'bin', 'lol.js'), 'up', '--no-pick'], { cwd: f.dir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }, stdio: ['ignore', fs.openSync(path.join(f.dir, 'up.log'), 'w'), fs.openSync(path.join(f.dir, 'up.err'), 'w')] }));
    }
    for (const f of FARMS.filter((x) => !x.external)) {
        for (let i = 0; i < 240 && !(f.snap = await getJson(`http://127.0.0.1:${f.http}/lol/self`)); i++) await sleep(1000);
        if (!f.snap) throw new Error(`farm ${f.key} did not answer: ${f.dir}/up.log`);
        log(`farm ${f.key} up: id ${f.snap.id.slice(0, 8)}, gate ${f.proxy}`);
    }

    // 4. The seal: a listener on the office's beacon group hears nothing of the rehearsal (its farms' beacons are off).
    const office = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const heard = [];
    office.on('message', (m, r) => { try { const s = JSON.parse(m); if (FARMS.some((f) => f.snap.id === s.id)) heard.push(r.address); } catch { /* not a beacon */ } });
    await new Promise((r) => office.bind(41998, r));
    try { office.addMembership('239.255.43.10'); } catch { /* joined on the default interface */ }

    // 5. The lossy /lol/self proxies (farm A's fails during its outage) and the beacon relay (unicast to 127.0.0.1).
    // With --seats, each client has its own (a proxy per client and farm, to tell it its own relay), and a TCP relay per
    // client and farm that reaches the gate from the client's own address.
    const servers = [];
    const owners = SEATS ? Array.from({ length: CLIENTS }, (_, i) => i) : [0];
    for (const f of FARMS) {
        for (const i of owners) {
            const lossy = http.createServer(async (req, res) => {
                if (f.key === 'A' && outage()) { req.socket.destroy(); return; }   // a Wi-Fi that lost the farm: no answer
                const s = await getJson(`http://127.0.0.1:${f.http}${req.url}`, 3000);
                if (!s) { res.writeHead(502).end(); return; }
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(forClient(f, s, i)));
            });
            servers.push(lossy);
            const lossyAt = await listen(lossy, SEATS ? 0 : f.lossy);
            if (!SEATS) continue;
            const relayTo = net.createServer((sock) => {
                const up = net.connect({ host: '127.0.0.1', port: f.proxy, localAddress: seatAddress(i) });
                const end = () => { sock.destroy(); up.destroy(); };
                sock.on('error', end); up.on('error', end); sock.on('close', end); up.on('close', end);
                sock.pipe(up); up.pipe(sock);
            });
            servers.push(relayTo);
            own_ports.set(`${f.key}${i}`, { lossy: lossyAt, gate: await listen(relayTo, 0) });
        }
    }
    if (SEATS) log(`seats: client i reaches the gates from ${seatAddress(0)}…${seatAddress(CLIENTS - 1)}`);
    const relay = dgram.createSocket('udp4');
    const ports = Array.from({ length: CLIENTS }, (_, i) => 42101 + i);
    const relayTick = async () => {
        for (const f of FARMS) {
            if (f.key === 'A' && outage()) continue;
            const s = await getJson(`http://127.0.0.1:${f.http}/lol/self`);
            if (!s) continue;
            ports.forEach((p, i) => relay.send(Buffer.from(JSON.stringify(forClient(f, s, i))), p, '127.0.0.1'));
        }
    };
    const relayTimer = setInterval(relayTick, 5000); void relayTick();

    // --slow-start: the busy loops on CPU 0, then every new Open WebUI process of a client held there (checked each second).
    const slowed = new Set();
    let slowTimer = null;
    if (SLOW) {
        const hogs = Array.from({ length: SLOW }, () => own(spawn(process.execPath, ['-e', 'for(;;){}'], { stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } })));
        spawnSync('powershell.exe', ['-NoProfile', '-Command', hogs.map((h) => `(Get-Process -Id ${h.pid}).ProcessorAffinity = 1`).join('; ')]);
        log(`slow start: ${SLOW} busy loops on CPU 0`);
        slowTimer = setInterval(() => {
            const out = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process -Filter "Name=\'python.exe\'" | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], { encoding: 'utf8' }).stdout || '';
            const parent = new Map(out.split(/\r?\n/).map((l) => l.trim().split(' ').map(Number)).filter((x) => x.length === 2));
            const clientPids = new Set(results.map((r) => r.proc.pid));
            const ofClient = (pid) => { for (let p = pid, k = 0; p && k < 6; k++) { const up = parent.get(p); if (clientPids.has(up)) return true; p = up; } return false; };
            const fresh = [...parent.keys()].filter((pid) => !slowed.has(pid) && ofClient(pid));
            if (!fresh.length) return;
            for (const pid of fresh) slowed.add(pid);
            spawnSync('powershell.exe', ['-NoProfile', '-Command', fresh.map((pid) => `try { (Get-Process -Id ${pid} -ErrorAction Stop).ProcessorAffinity = 1 } catch {}`).join('; ')]);
        }, 1000);
    }
    // N clients on one machine race for Open WebUI's preferred port 8080 (findFreePort checks, Open WebUI binds ~10 s
    // later): held here, each gets its own from the system. A laptop runs one Open WebUI and has no such race.
    const hold8080 = require('net').createServer().listen(8080, '127.0.0.1');
    // 6. The clients: fresh userData (its sidecar/ a junction to the released one) and fresh data folders, started at once.
    const results = [];
    for (let i = 0; i < CLIENTS; i++) {
        const ud = path.join(ROOT, `client${i}`, 'userData'); const dd = path.join(ROOT, `client${i}`, 'data');
        fs.mkdirSync(ud, { recursive: true }); fs.mkdirSync(dd, { recursive: true });
        execFileSync('cmd', ['/c', 'mklink', '/J', path.join(ud, 'sidecar'), SIDECAR], { stdio: 'ignore' });
        // Launched at their own moment within a beacon period, as students press Start: one may meet a beacon in its
        // first 4.5 s, another not.
        if (i) await sleep(BLIP != null ? 300 : 1000 + Math.round(Math.random() * 4000));
        if (launchedAt == null) launchedAt = Date.now();
        const r = { client: i, events: [], launchAt: Date.now() };
        const c = own(spawn(process.execPath, [path.join(__dirname, 'client.cjs')], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '', REH_BUILD: process.env.REH_BUILD || '', REH_USERDATA: ud, REH_DATADIR: dd, REH_NAME: `client${i}`, LOL_FED_GROUP: GROUP, LOL_FED_PORT: String(ports[i]) },
            stdio: ['pipe', 'pipe', fs.openSync(path.join(ROOT, `client${i}`, 'stderr.log'), 'w')],
        }));
        r.proc = c;
        let buf = '';
        c.stdout.on('data', (d) => {
            buf += d; let k;
            while ((k = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, k); buf = buf.slice(k + 1);
                try { const e = JSON.parse(line); e.at = Date.now() - r.launchAt; r.events.push(e); if (e.kind !== 'farms') log(`client${i}`, e.kind, e.status || e.farm || '', e.message ? `"${String(e.message).slice(0, 70)}"` : ''); } catch { /* not ours */ }
            }
        });
        results.push(r);
    }

    // 7. The first answered chat: once a client's Open WebUI is ready, one short question through the farm it chose.
    let done = false;
    const firstChat = async (r) => {
        while (!done) {
            await sleep(1000);
            if (r.chatAt) return;
            const ready = r.events.find((e) => e.kind === 'owui' && e.status === 'ready');
            const choice = [...r.events].reverse().find((e) => e.kind === 'choice');
            if (!ready || !choice) continue;
            const t = Date.now();
            try {
                const res = await fetch(`${choice.endpoint}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ model: MODEL, max_tokens: 20, messages: [{ role: 'user', content: 'Say hi.' }] }), signal: AbortSignal.timeout(60000) });
                if (!res.ok) r.chatError = `${res.status} ${(await res.text()).slice(0, 160)}`;
                if (res.ok) { r.chatAt = Date.now() - r.launchAt; r.chatMs = Date.now() - t; r.chatFarm = choice.farm; log(`client${r.client} first chat answered by ${choice.farm} at ${(r.chatAt / 1000).toFixed(1)} s`); }
            } catch (e) { r.chatError = String(e && e.message || e); }
        }
    };
    results.forEach((r) => void firstChat(r));

    // Memory (step 2): every 30 s, the working set of each client's process tree (its Node and its Open WebUI), and the
    // computer's free memory. One process list a sample, the trees worked out here.
    const memory = [];
    const sampleMemory = () => {
        const out = spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.WorkingSetSize)" }; "free $((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory)"'], { encoding: 'utf8' }).stdout || '';
        const kids = new Map(); const ws = new Map(); let freeKb = null;
        for (const l of out.split(/\r?\n/)) {
            const m = /^(\d+) (\d+) (\d+)$/.exec(l.trim());
            if (m) { const [pid, ppid, w] = m.slice(1).map(Number); ws.set(pid, w); if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(pid); }
            const f = /^free (\d+)$/.exec(l.trim()); if (f) freeKb = Number(f[1]);
        }
        const tree = (pid) => (ws.get(pid) || 0) + (kids.get(pid) || []).reduce((a, k) => a + tree(k), 0);
        const per = results.map((r) => Math.round(tree(r.proc.pid) / 2 ** 20));
        memory.push({ atS: Math.round((Date.now() - t0) / 1000), perClientMiB: per, totalMiB: per.reduce((a, b) => a + b, 0), freeMiB: freeKb == null ? null : Math.round(freeKb / 1024) });
    };
    const memTimer = setInterval(sampleMemory, 30_000); sampleMemory();

    const bursts = [];
    if (!BURSTS) await sleep(MINUTES * 60_000);
    else {
        // Step 3: wait for every client (first chat answered, and its Open WebUI ready NOW: a client that started on no
        // farm restarts it once on its farm, after its first chat), then the rounds.
        const until = Date.now() + MINUTES * 60_000;
        const settled = (r) => { const s = r.events.filter((e) => e.kind === 'owui'); return r.chatAt && s.length && s[s.length - 1].status === 'ready'; };
        while (Date.now() < until && !results.every(settled)) await sleep(1000);
        log(`${results.filter(settled).length}/${CLIENTS} clients ready and answered: ${BURSTS} round(s) of ${CLIENTS} at once`);
        for (const r of results) r.owui = await signIn(r);
        // Round 0: one person alone, the reference ("slow" is slower than this); then the rounds of everyone at once.
        for (let k = 0; k <= BURSTS; k++) {
            for (const mode of ['A', 'B']) {
                const live = results.filter((r) => r.chatAt && (mode === 'A' || r.owui.token)).slice(0, k === 0 ? 1 : CLIENTS);
                // The gate's view while the round runs, and after it: a seat stays with its address 15 minutes after a
                // generation, so seats held after the round = the addresses the gate saw.
                const gate = [];
                const sampleGate = async () => { const s = await getJson(`http://127.0.0.1:${FARMS[0].http}/lol/self`); if (s && s.capacity) gate.push({ atMs: Date.now() - roundAt, seatsUsed: s.capacity.seatsUsed, busy: s.capacity.busy, queued: s.capacity.queued }); };
                const roundAt = Date.now();
                setTimeout(sampleGate, 500);
                const watch = setInterval(sampleGate, 1000);
                const per = await Promise.all(live.map((r) => {
                    const choice = [...r.events].reverse().find((e) => e.kind === 'choice');
                    const body = { model: mode === 'A' ? MODEL : r.owui.model, stream: true, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content: PROMPT }], ...(THINK ? {} : { chat_template_kwargs: { enable_thinking: false } }) };
                    return mode === 'A'
                        ? streamOnce(`${choice.endpoint}/chat/completions`, {}, body)
                        : streamOnce(`${r.owui.url}/api/chat/completions`, { authorization: `Bearer ${r.owui.token}` }, body);
                }));
                clearInterval(watch);
                await sampleGate();
                const b = { round: k, mode: mode === 'A' ? 'straight to the gate' : "through each client's Open WebUI", people: live.length, gate, summary: summarize(per), per };
                bursts.push(b);
                log(`round ${k} ${mode}: ${JSON.stringify(b.summary)} · gate: seats held after ${gate.length ? gate[gate.length - 1].seatsUsed : '?'}, at most ${Math.max(0, ...gate.map((g) => g.busy || 0))} generating, ${Math.max(0, ...gate.map((g) => g.queued || 0))} waiting`);
                await sleep(5000);
            }
        }
    }
    done = true;
    if (slowTimer) clearInterval(slowTimer);
    clearInterval(memTimer); sampleMemory();

    // 8. The connections each client and its Open WebUI hold now (the seal, from the other side).
    const conns = {};
    for (const r of results) {
        const pids = [r.proc.pid, ...String(spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${r.proc.pid} }).ProcessId`], { encoding: 'utf8' }).stdout || '').split(/\s+/).filter(Boolean).map(Number)];
        const out = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-NetTCPConnection -OwningProcess ${pids.join(',')} -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Established' } | ForEach-Object { $_.RemoteAddress }`], { encoding: 'utf8' }).stdout || '';
        conns[`client${r.client}`] = [...new Set(out.split(/\s+/).filter(Boolean))];
    }

    // 9. Stop: the clients (each stops its Open WebUI), the relay, the farms (lol down), the scratch Ollama.
    for (const r of results) { try { r.proc.stdin.write('stop\n'); } catch { /* gone */ } }
    await sleep(15000);
    clearInterval(relayTimer); relay.close(); hold8080.close(); office.close(); for (const s of servers) s.close();
    for (const f of FARMS.filter((x) => !x.external)) spawnSync(process.execPath, [path.join(f.code, 'bin', 'lol.js'), 'down'], { cwd: f.dir, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    for (const c of children) { try { c.kill(); } catch { /* gone */ } }

    // 10. The report.
    const report = {
        at: new Date().toISOString(), clients: CLIENTS, minutes: MINUTES, outage: { silentS: OUT_ON, everyS: OUT_ON + OUT_OFF }, blipS: BLIP,
        farm: EXTERNAL ? { name: FARMS[0].snap.name, backend: FARMS[0].snap.backend } : 'two scratch farms', seats: SEATS ? 'one address a client' : 'all on 127.0.0.1',
        slowStart: SLOW ? { busyLoopsOnCpu0: SLOW, openWebUiProcessesHeld: slowed.size } : null,
        bursts: bursts.length ? { prompt: PROMPT, maxTokens: MAX_TOKENS, model: MODEL, thinking: THINK ? 'the model default (on)' : 'off', rounds: bursts.map(({ per, ...b }) => ({ ...b, per })) } : null,
        // Review L2 (night n° 10), live: a healthy first start leaves the ready record and no first-start marker.
        firstStartRecords: results.map((r) => { const dd = path.join(ROOT, `client${r.client}`, 'data'); return { ready: fs.existsSync(path.join(dd, 'lol-owui-ready')), marker: fs.existsSync(path.join(dd, 'lol-owui-first-start')) }; }),
        owui: fs.readFileSync(path.join(SIDECAR, 'OPENWEBUI_VERSION'), 'utf8').trim(), build: process.env.REH_BUILD || 'this checkout', sealHeard: heard, connections: conns, memory,
        perClient: results.map((r) => {
            const choices = r.events.filter((e) => e.kind === 'choice');
            const states = r.events.filter((e) => e.kind === 'owui');
            return {
                client: r.client, farmMoves: Math.max(0, choices.length - 1), farms: choices.map((c) => `${(c.at / 1000).toFixed(1)}s ${c.farm}`),
                states: states.map((s) => `${(s.at / 1000).toFixed(1)}s ${s.status}${s.message ? `: ${String(s.message).slice(0, 60)}` : ''}`),
                keepsExiting: states.some((s) => /keeps exiting/.test(s.message || '')), repairable: states.some((s) => s.repairable),
                // Ready on its farm: the first ready after Open WebUI's last start or restart (a start on no farm, then a
                // repoint deferred to its end, is two starts).
                readyS: (() => { let k = -1; states.forEach((s, j) => { if (s.status === 'starting' || s.status === 'restarting') k = j; }); const ok = states.slice(k + 1).find((s) => s.status === 'ready'); return ok ? ok.at / 1000 : null; })(),
                starts: states.filter((s) => s.status === 'starting').length,
                chatError: r.chatAt ? null : (r.chatError || null), launchedS: (r.launchAt - t0) / 1000, firstChatS: r.chatAt ? r.chatAt / 1000 : null, chatFarm: r.chatFarm || null,
                owuiSignIn: r.owui ? { url: r.owui.url, model: r.owui.model || null, models: r.owui.models || null, error: r.owui.error || null } : null,
            };
        }),
    };
    const out = path.join(REPO, 'docs', 'spike', 'results', `rehearsal-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}-${CLIENTS}c.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ bursts: bursts.map((b) => ({ round: b.round, mode: b.mode, people: b.people, ...b.summary })), firstStartRecords: report.firstStartRecords }, null, 1));
    console.log(JSON.stringify({ sealHeard: heard.length, memoryPeakMiB: Math.max(...memory.map((m) => m.totalMiB)), memoryLast: memory[memory.length - 1], connections: conns, perClient: report.perClient.map((p) => ({ client: p.client, farmMoves: p.farmMoves, keepsExiting: p.keepsExiting, readyS: p.readyS, firstChatS: p.firstChatS, chatError: p.chatError })) }, null, 1));
    log('report:', out, '· scratch:', ROOT);
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    for (const f of FARMS.filter((x) => !x.external && x.dir)) spawnSync(process.execPath, [path.join(f.code, 'bin', 'lol.js'), 'down'], { cwd: f.dir, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    for (const c of children) { try { c.kill(); } catch { /* gone */ } }
    process.exit(1);
});
