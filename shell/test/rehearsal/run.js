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
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
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
const MODEL = 'qwen3:0.6b';
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

const FARMS = [
    { key: 'A', name: 'Rehearsal farm A (lossy)', proxy: 4390, http: 41991, lossy: 41981, code: path.join(REPO, 'farm') },
    { key: 'B', name: 'Rehearsal farm B', proxy: 4392, http: 41993, lossy: 41983, code: path.join(ROOT, 'farmB-code') },
];
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

async function main() {
    if (!SIDECAR || !fs.existsSync(path.join(SIDECAR, 'launcher.py'))) throw new Error('Set REH_SIDECAR to the released Open WebUI sidecar folder (python/, launcher.py).');
    log(`rehearsal in ${ROOT}: ${CLIENTS} clients, ${MINUTES} min, farm A silent ${OUT_ON} s every ${OUT_ON + OUT_OFF} s; Open WebUI ${fs.readFileSync(path.join(SIDECAR, 'OPENWEBUI_VERSION'), 'utf8').trim()}`);

    // 1. The scratch Ollama (its own port and models folder), and the small model.
    if (!(await getJson(`${OLLAMA}/api/version`))) {
        const models = path.join(ROOT, 'ollama-models'); fs.mkdirSync(models);
        own(spawn('ollama', ['serve'], { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11500', OLLAMA_MODELS: models }, stdio: 'ignore' }));
        for (let i = 0; i < 40 && !(await getJson(`${OLLAMA}/api/version`)); i++) await sleep(500);
        log('scratch Ollama on 11500, models in', models);
    }
    spawnSync('ollama', ['pull', MODEL], { env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11500' }, stdio: 'ignore' });

    // 2. Farm B's own copy of the farm code (its own id, runtime file and LiteLLM venv), without the big model folders.
    const skip = new Set(['.models', '.llamacpp', '.searxng', '.kokoro', '.extract', '.classify', '.stt', '.embed', '.lol-id', '.lol-secret', '.lol-runtime.json', 'lol.config.json', 'litellm']);
    fs.cpSync(FARMS[0].code, FARMS[1].code, { recursive: true, filter: (src) => !skip.has(path.basename(src)) || path.dirname(src) !== FARMS[0].code });
    fs.mkdirSync(path.join(FARMS[1].code, 'litellm'), { recursive: true });

    // 3. The two farms: Ollama's small model, beacons off, plugins off, their own ports; each run from its own folder.
    for (const f of FARMS) {
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
    for (const f of FARMS) {
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
    for (const f of FARMS) {
        f.lossyServer = http.createServer(async (req, res) => {
            if (f.key === 'A' && outage()) { req.socket.destroy(); return; }   // a Wi-Fi that lost the farm: no answer
            const s = await getJson(`http://127.0.0.1:${f.http}${req.url}`, 3000);
            if (!s) { res.writeHead(502).end(); return; }
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...say(f, loopback(s)), httpPort: f.lossy }));
        }).listen(f.lossy, '127.0.0.1');
    }
    const relay = dgram.createSocket('udp4');
    const ports = Array.from({ length: CLIENTS }, (_, i) => 42101 + i);
    const relayTick = async () => {
        for (const f of FARMS) {
            if (f.key === 'A' && outage()) continue;
            const s = await getJson(`http://127.0.0.1:${f.http}/lol/self`);
            if (!s) continue;
            const buf = Buffer.from(JSON.stringify({ ...say(f, loopback(s)), httpPort: f.lossy }));
            for (const p of ports) relay.send(buf, p, '127.0.0.1');
        }
    };
    const relayTimer = setInterval(relayTick, 5000); void relayTick();

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

    await sleep(MINUTES * 60_000);
    done = true;
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
    clearInterval(relayTimer); relay.close(); hold8080.close(); office.close(); for (const f of FARMS) f.lossyServer.close();
    for (const f of FARMS) spawnSync(process.execPath, [path.join(f.code, 'bin', 'lol.js'), 'down'], { cwd: f.dir, stdio: 'ignore', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    for (const c of children) { try { c.kill(); } catch { /* gone */ } }

    // 10. The report.
    const report = {
        at: new Date().toISOString(), clients: CLIENTS, minutes: MINUTES, outage: { silentS: OUT_ON, everyS: OUT_ON + OUT_OFF }, blipS: BLIP,
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
            };
        }),
    };
    const out = path.join(REPO, 'docs', 'spike', 'results', `rehearsal-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}-${CLIENTS}c.json`);
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ sealHeard: heard.length, memoryPeakMiB: Math.max(...memory.map((m) => m.totalMiB)), memoryLast: memory[memory.length - 1], connections: conns, perClient: report.perClient.map((p) => ({ client: p.client, farmMoves: p.farmMoves, keepsExiting: p.keepsExiting, readyS: p.readyS, firstChatS: p.firstChatS, chatError: p.chatError })) }, null, 1));
    log('report:', out, '· scratch:', ROOT);
    process.exit(0);
}

main().catch((e) => { console.error(e); for (const c of children) { try { c.kill(); } catch { /* gone */ } } process.exit(1); });
