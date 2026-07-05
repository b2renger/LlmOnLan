// `lol up` (alias `lol serve`) — bring the farm online from lol.config.json.
//
// Steps: ensure each Ollama host is reachable → pull configured models →
// generate the LiteLLM config.yaml → start + health-wait the proxy → (M3) start
// the discovery beacon → supervise in the foreground until Ctrl-C.
//
// Runs in the foreground and writes .lol-runtime.json so `lol status` / `lol down`
// work from another shell.

const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const log = require('../log');
const ollama = require('../ollama');
const proxyApi = require('../proxy');
const { loadConfig } = require('../config');
const { writeLitellmConfig, servedEntries } = require('../litellm');
const { buildSnapshot } = require('../snapshot');
const { detectHardware, gpuLiveStats } = require('../systemInfo');
const { DiscoveryBeacon } = require('../beacon');
const { PeerListener } = require('../peerListener');
const { selectModels } = require('../modelPicker');
const { makeServices, pluginsSummary } = require('../plugins/registry');
const { farmId } = require('../identity');
const { startSelfServer } = require('../selfServer');
const {
    readRuntime, writeRuntime, clearRuntime, isAlive, killTree, spawnLitellm,
} = require('../proc');

const LOCAL_RX = /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i;

function isLocalHost(baseUrl) {
    try { return LOCAL_RX.test(new URL(baseUrl).hostname); } catch { return false; }
}

// The vision model the OCR service drives: an explicit config.ocr.model wins; else
// the served DEFAULT model if it's vision-capable; else any served vision model;
// else the default (so it at least runs — a text-only model just OCRs poorly). This
// is the real Ollama tag (`underlying`), since Ollama-OCR hits raw Ollama, not the
// alias-fronted proxy.
function resolveOcrModel(config) {
    if (config.ocr.model) return config.ocr.model;
    const entries = servedEntries(config);
    const pick = entries.find((e) => e.isDefault && e.vision)
        || entries.find((e) => e.vision)
        || entries.find((e) => e.isDefault)
        || entries[0];
    return pick ? pick.underlying : (config.models[0] && config.models[0].id);
}

// Spawn a local `ollama serve` with the configured concurrency env. Returns the
// child pid, or null if it couldn't be started. Only used when a LOCAL host is
// down — we never touch a remote box or an already-running local Ollama.
function spawnLocalOllama(config, baseUrl) {
    const env = {
        OLLAMA_NUM_PARALLEL: String(config.ollama.numParallel),
        OLLAMA_MAX_LOADED_MODELS: String(config.ollama.maxLoadedModels),
        OLLAMA_FLASH_ATTENTION: config.ollama.flashAttention ? '1' : '0',
        // Keep the model warm in VRAM (no reload after idle) — see config.keepAlive.
        OLLAMA_KEEP_ALIVE: config.ollama.keepAlive,
        // Context window big enough for whole-document chat — see config.contextLength.
        OLLAMA_CONTEXT_LENGTH: String(config.ollama.contextLength),
    };
    try {
        const u = new URL(baseUrl);
        env.OLLAMA_HOST = `${u.hostname}:${u.port || 11434}`;
        const child = spawn('ollama', ['serve'], {
            shell: process.platform === 'win32',
            windowsHide: true,
            detached: process.platform !== 'win32',
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', log.childPrefix('ollama'));
        child.stderr.on('data', log.childPrefix('ollama'));
        child.on('error', () => {});
        return child.pid || null;
    } catch {
        return null;
    }
}

async function ensureOllama(config) {
    const hosts = config.ollama.hosts.map(ollama.normalizeHost);
    const reachable = [];
    const spawnedPids = [];

    for (const host of hosts) {
        let v = await ollama.version(host);
        if (!v && isLocalHost(host)) {
            log.step(`Ollama not up on ${host} — starting it locally …`);
            const pid = spawnLocalOllama(config, host);
            if (pid) {
                spawnedPids.push(pid);
                // Wait up to ~15s for it to answer.
                for (let i = 0; i < 20 && !v; i++) {
                    await new Promise((r) => setTimeout(r, 750));
                    v = await ollama.version(host);
                }
            }
        }
        if (v) { reachable.push(host); log.ok(`Ollama ${log.paint.bold(v)} @ ${host}`); }
        else { log.warn(`Ollama unreachable @ ${host} — clients won't be routed there.`); }
    }

    if (!reachable.length) {
        log.err('No reachable Ollama host. Start Ollama (https://ollama.com) and check ollama.hosts.');
        return null;
    }

    // Concurrency env only takes effect when Ollama STARTS. If a host was already
    // up, we can't change it — surface the recommended values instead of lying.
    const alreadyUp = reachable.filter((h) => !spawnedPids.length || !isLocalHost(h));
    if (alreadyUp.length) {
        log.info(
            `Note: set on each Ollama service to apply concurrency/keep-warm/context — ` +
            `OLLAMA_NUM_PARALLEL=${config.ollama.numParallel} ` +
            `OLLAMA_MAX_LOADED_MODELS=${config.ollama.maxLoadedModels} ` +
            `OLLAMA_FLASH_ATTENTION=${config.ollama.flashAttention ? 1 : 0} ` +
            `OLLAMA_KEEP_ALIVE=${config.ollama.keepAlive} ` +
            `OLLAMA_CONTEXT_LENGTH=${config.ollama.contextLength}`
        );
    }
    return { reachable, spawnedPids };
}

async function pullMissing(config, reachable) {
    for (const host of reachable) {
        const present = await ollama.listModels(host);
        for (const m of config.models) {
            if (ollama.hasModel(present, m.id)) continue;
            const label = (() => { try { return new URL(host).host; } catch { return host; } })();
            log.step(`${label}: pulling ${log.paint.bold(m.id)} (first run can be slow) …`);
            try {
                let last = '';
                await ollama.pullModel(host, m.id, (s) => {
                    if (s !== last) { last = s; process.stdout.write(`\r${log.paint.grey(`[${label}]`)} ${s}            `); }
                });
                process.stdout.write('\n');
                log.ok(`${label}: ${m.id} ready.`);
            } catch (e) {
                process.stdout.write('\n');
                log.warn(`${label}: could not pull ${m.id} — ${e.message}`);
            }
        }
    }
}

// Coordinator mode: listen briefly for peer farms on the LAN (beacons + a unicast
// sweep) and return them as LiteLLM peer deployments. Static at boot — the fleet's
// membership is captured once here; a box added later is picked up by restarting
// the coordinator. Self is excluded by farm id.
async function discoverPeers(config) {
    const listener = new PeerListener({
        group: config.beacon.group,
        port: config.beacon.port,
        httpPort: config.beacon.httpPort,
        selfId: farmId(),
    }).start();
    log.step('Coordinator: discovering peer farms on the LAN …');
    const windowMs = Math.max(6000, config.beacon.intervalSec * 2000 + 1500);
    await Promise.all([
        new Promise((r) => setTimeout(r, windowMs)),
        listener.sweep().catch(() => {}),      // for broadcast-blocked LANs
    ]);
    const peers = listener.getPeers()
        .filter((p) => p.snap.healthy !== false && !p.snap.coordinator) // skip other coordinators
        .map((p) => ({
            openaiBaseUrl: p.snap.openaiBaseUrl,
            models: p.snap.models,
            name: p.snap.name,
            host: p.host,
        }));
    listener.stop();
    return peers;
}

// --alias <name> / --alias=name overrides the stable model alias for this run;
// --no-alias disables it. undefined = not specified (keep config.modelAlias).
function parseAliasFlag(args) {
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--no-alias') return null;
        if (a === '--alias') { const v = args[i + 1]; if (v && !v.startsWith('-')) return v.trim(); }
        else if (a.startsWith('--alias=')) return a.slice('--alias='.length).trim();
    }
    return undefined;
}

async function run(args) {
    let config, configPath;
    try { ({ config, path: configPath } = loadConfig()); }
    catch (e) { log.err(e.message); return 1; }
    const coordinator = (args || []).includes('--coordinator') || config.coordinator === true;
    const aliasArg = parseAliasFlag(args || []);
    if (aliasArg !== undefined) config.modelAlias = aliasArg;
    // Web search: config is the default, per-run flags override.
    if ((args || []).includes('--websearch')) config.websearch.enabled = true;
    if ((args || []).includes('--no-websearch')) config.websearch.enabled = false;
    if ((args || []).includes('--tts')) config.tts.enabled = true;
    if ((args || []).includes('--no-tts')) config.tts.enabled = false;
    if ((args || []).includes('--ocr')) config.ocr.enabled = true;
    if ((args || []).includes('--no-ocr')) config.ocr.enabled = false;
    // Admin control token (start/stop models, toggle plugins from the /lol/admin page).
    // Ephemeral per run when unset — printed in the banner so the operator can paste it.
    if (!config.admin.token) config.admin.token = crypto.randomBytes(24).toString('hex');
    const adminToken = config.admin.token;

    // Refuse to double-start.
    const existing = readRuntime();
    if (existing && isAlive(existing.litellmPid)) {
        log.err(`Farm already running (LiteLLM pid ${existing.litellmPid}, ${existing.endpoint}). Run \`lol down\` first.`);
        return 1;
    }
    if (existing) clearRuntime(); // stale

    log.info(`Bringing up ${log.paint.bold(config.name)} …`);

    // 1. Ollama
    const oll = await ensureOllama(config);
    if (!oll) return 1;

    // 1b. Choose which installed model(s) to serve (interactive picker, or
    //     --model / --no-pick / non-TTY → the configured catalog). Drives THIS run.
    config.models = await selectModels(config, oll.reachable, args || []);

    // 2. Models — pull any chosen model a host is missing (no-op for picked ones).
    await pullMissing(config, oll.reachable);

    // 3. (Coordinator) discover peer farms, then generate the LiteLLM config —
    //    routing is derived from local Ollama hosts + any aggregated peers.
    const peers = coordinator ? await discoverPeers(config) : [];
    if (coordinator) {
        if (peers.length) log.ok(`Coordinator: aggregating ${peers.length} peer farm(s) — ${peers.map((p) => p.name || p.host).join(', ')}`);
        else log.warn('Coordinator: no peer farms found — serving local only. Start the peers first, then re-run to include them.');
    }
    const yamlPath = writeLitellmConfig(config, undefined, peers);
    const backends = config.ollama.hosts.length + peers.length;
    log.ok(`Generated LiteLLM routing → ${log.paint.grey(yamlPath)} (${config.models.length} model × ${config.ollama.hosts.length} host${peers.length ? ` + ${peers.length} peer` : ''} deployments)`);
    const alias = (config.modelAlias || '').trim();
    if (alias) {
        const real = (config.models.find((m) => m.default) || config.models[0]).id;
        log.ok(`Model alias: clients see ${log.paint.bold(`"${alias}"`)} → ${log.paint.bold(real)} (switch the model anytime without breaking chats)`);
    }

    // 4. Start + health-wait the proxy.
    const baseUrl = `http://127.0.0.1:${config.proxy.port}`;
    log.step(`Starting LiteLLM proxy on ${config.proxy.host}:${config.proxy.port} …`);
    // `child` is a `let` so the admin control API can bounce the proxy in place
    // (restartProxy below) to change the served model set without a full `lol up`.
    let child = spawnLitellm(config, yamlPath);
    let restartingProxy = false;   // true while restartProxy() deliberately bounces LiteLLM
    const wireProxyIo = (c) => {
        c.stdout.on('data', log.childPrefix('litellm'));
        c.stderr.on('data', log.childPrefix('litellm'));
    };
    let spawnFailed = false;
    child.on('error', (e) => {
        spawnFailed = true;
        if (e.code === 'ENOENT') {
            log.err(`LiteLLM not found ('${config.litellm.command}'). Install it (pip install 'litellm[proxy]') or set litellm.command in lol.config.json.`);
        } else {
            log.err(`Failed to start LiteLLM: ${e.message}`);
        }
    });
    wireProxyIo(child);

    const up = await proxyApi.waitForProxy(baseUrl, { timeoutMs: 90000 });
    if (spawnFailed) return 1;
    if (!up) {
        log.err('LiteLLM did not become healthy in time. Check the [litellm] logs above.');
        await killTree(child.pid);
        return 1;
    }

    const served = await proxyApi.listProxyModels(baseUrl, config.proxy.masterKey);
    log.ok(`Proxy healthy — ${log.paint.bold('/v1/models')}: ${served.length ? served.join(', ') : '(none yet)'}`);

    // 4b. Farm-side plugins (web search / voice / OCR) — one shared instance each for the
    // whole LAN, spawned + health-waited here and advertised in the snapshot. All three run
    // through the plugin registry so boot, live toggling (control.setPlugin), the health
    // timer, and teardown share ONE path. Auxiliary: a failure warns and the farm still
    // comes up without that plugin. (Client-side plugins like Blender aren't here — the
    // farm only recommends them via config.recommendedClientPlugins.)
    const services = makeServices();
    const svcById = Object.fromEntries(services.map((s) => [s.id, s]));
    const pluginRuntime = { log, crypto, resolveOcrModel, isLocalHost, reachable: oll.reachable };
    for (const svc of services) {
        if (!svc.enabled(config)) continue;
        const res = await svc.start(config, pluginRuntime);
        if (res && res.level && res.message) log[res.level](res.message);
    }

    // 5. Discovery — UDP beacon + unicast /lol/self (both share ONE snapshot so
    // they can't drift). liveHealth is refreshed on a timer below. The plugin flags are
    // read from the service instances (bespoke keys kept for snapshot back-compat).
    const liveHealth = {
        proxyUp: true,
        hostsUp: oll.reachable.length,
        hostsTotal: config.ollama.hosts.length,
        loaded: [],
        coordinator,                     // advertise the role so clients prefer us
        deployments: backends,           // local hosts + aggregated peers
        searxngUp: svcById.websearch.up, // advertise searxngUrl so clients get web search
        ttsUp: svcById.tts.up,           // advertise ttsUrl so clients get neural voice
        extractUp: svcById.ocr.up,       // advertise extract{} so clients get document OCR
        extractKey: svcById.ocr.up ? svcById.ocr.ctx.key : null, // bearer OWUI's loader must send
        plugins: pluginsSummary(services, config), // generic map for the admin page + clients
        clientsConnected: 0,             // desktop clients heartbeating us (see onClientPing)
        host: await detectHardware(),   // static GPU/VRAM/RAM/cores (once at boot)
        gpu: await gpuLiveStats(),       // live GPU util + VRAM (refreshed below)
    };
    if (liveHealth.host) log.ok(`Hardware: ${log.paint.bold(liveHealth.host.gpu)} · ${liveHealth.host.vramGb}GB VRAM · ${liveHealth.host.ramGb}GB RAM · ${liveHealth.host.cpuCores} cores`);
    const getSnapshot = () => buildSnapshot(config, liveHealth);
    const snapshot = getSnapshot();

    let beacon = null;
    if (config.beacon.enabled) {
        beacon = new DiscoveryBeacon({
            group: config.beacon.group,
            port: config.beacon.port,
            intervalSec: config.beacon.intervalSec,
            getSnapshot,
        }).start();
        log.ok(`Discovery beacon → multicast ${config.beacon.group}:${config.beacon.port} + broadcast, every ${config.beacon.intervalSec}s (id ${snapshot.id.slice(0, 8)})`);
    } else {
        log.info('Discovery beacon disabled (config.beacon.enabled=false).');
    }
    // The admin control API is populated with the real functions below; selfServer only
    // calls control.* at REQUEST time (after startup completes — there is no `await`
    // between here and the Object.assign), so late assignment is safe. The stub methods
    // are belt-and-suspenders in case a future edit inserts an await into that span.
    const control = {
        getAdminState: async () => ({ error: 'starting' }),
        startModel: async () => ({ ok: false, error: 'farm still starting' }),
        stopModel: async () => ({ ok: false, error: 'farm still starting' }),
        setPlugin: async () => ({ ok: false, error: 'farm still starting' }),
        recommendClientPlugin: () => ({ ok: false, error: 'farm still starting' }),
    };

    // Connected desktop clients — each shell POSTs /lol/client-ping every ~10 s with
    // { id, name, platform, version, idleSec } (open route, trusted LAN — the farm's
    // Node process never sees chat traffic, LiteLLM does, so presence comes from the
    // clients). Entries are TTL-filtered at READ time (no sweeper): a closed client
    // vanishes from the panel within ~30 s. `idleSec` is the client's system-wide
    // input idle (Electron powerMonitor) — "is a human at that machine".
    const clients = new Map();
    const CLIENT_TTL_MS = 30000;
    const freshClients = () => {
        const now = Date.now();
        for (const [id, c] of clients) if (now - c.lastSeen > 10 * CLIENT_TTL_MS) clients.delete(id); // GC the long-gone
        return [...clients.entries()]
            .filter(([, c]) => now - c.lastSeen <= CLIENT_TTL_MS)
            .map(([id, c]) => ({ id, ...c, lastSeenSec: Math.round((now - c.lastSeen) / 1000) }))
            .sort((a, b) => (a.idleSec ?? Infinity) - (b.idleSec ?? Infinity));
    };
    const strCap = (v, max) => String(v == null ? '' : v).slice(0, max).trim();
    function onClientPing(body, ip) {
        if (!body || typeof body !== 'object') return { ok: false };
        const id = strCap(body.id, 64);
        if (!id) return { ok: false };
        if (!clients.has(id) && clients.size >= 200) {
            // Map full (garbage-flood cap). Don't just reject the newcomer — that would
            // let 200 junk ids lock every NEW real client out of presence. Free the
            // non-fresh slots first (they're already invisible in the UI), and if a
            // flood of still-live ids fills it anyway, evict the oldest: an actively-
            // heartbeating real client always wins a slot.
            const now = Date.now();
            for (const [cid, c] of clients) if (now - c.lastSeen > CLIENT_TTL_MS) clients.delete(cid);
            if (clients.size >= 200) {
                let oldest = null;
                for (const [cid, c] of clients) if (!oldest || c.lastSeen < oldest[1]) oldest = [cid, c.lastSeen];
                if (oldest) clients.delete(oldest[0]);
            }
        }
        clients.set(id, {
            name: strCap(body.name, 64) || null,
            platform: strCap(body.platform, 16) || null,
            version: strCap(body.version, 32) || null,
            idleSec: Number.isFinite(body.idleSec) ? Math.max(0, Math.round(body.idleSec)) : null,
            ip: strCap(ip, 64).replace(/^::ffff:/, '') || null,
            lastSeen: Date.now(),
        });
        liveHealth.clientsConnected = freshClients().length;
        return { ok: true };
    }
    const selfServer = startSelfServer({ httpPort: config.beacon.httpPort, getSnapshot, host: config.proxy.host, control, adminToken, onClientPing });
    log.ok(`Unicast discovery → ${log.paint.grey(`http://<ip>:${config.beacon.httpPort}/lol/self`)}`);
    log.ok(`Admin panel → ${log.paint.grey(`http://<ip>:${config.beacon.httpPort}/lol/admin`)} ${log.paint.grey('(token in the startup banner)')}`);

    // If SearXNG dies after boot, stop advertising it immediately (auxiliary — the
    // farm stays up; clients then cleanly disable web search). The health timer
    // below also re-probes it, catching a hung-but-not-exited instance.
    // Advertise-off: if a running plugin's child later exits, stop advertising it + kick.
    // bringUp/bringDown reuse the same liveHealth wiring so live toggles (control.setPlugin)
    // and boot behave identically.
    const refreshPluginHealth = () => { liveHealth.plugins = pluginsSummary(services, config); };
    const applyPluginHealth = (svc) => {
        liveHealth[svc.healthKey] = svc.up;
        if (svc.id === 'ocr') liveHealth.extractKey = svc.up ? svc.ctx.key : null;
        refreshPluginHealth();
    };
    for (const svc of services) {
        svc.onDown = (s) => {
            log.warn(`${s.label} exited — no longer available to clients.`);
            applyPluginHealth(s);
            if (beacon) beacon.kick();
        };
    }
    async function bringUp(svc) {
        const res = await svc.start(config, pluginRuntime);
        if (res && res.level && res.message) log[res.level](res.message);
        applyPluginHealth(svc);
        return svc.up;
    }
    async function bringDown(svc) {
        await svc.stop();
        applyPluginHealth(svc);
    }

    // Keep the advertised health honest: re-probe proxy + hosts periodically and
    // push a fresh beacon. Cheap (a few HTTP HEADs) and unref'd.
    const hosts = config.ollama.hosts.map(ollama.normalizeHost);
    let healthInFlight = false; // skip a tick if the previous probe round is still running
    const healthTimer = setInterval(async () => {
        if (healthInFlight) return;
        healthInFlight = true;
        try {
            liveHealth.proxyUp = await proxyApi.proxyLive(baseUrl);
            const ups = await Promise.all(hosts.map((h) => ollama.version(h)));
            liveHealth.hostsUp = ups.filter(Boolean).length;
            const loadedLists = await Promise.all(hosts.map((h) => ollama.loadedModels(h)));
            liveHealth.loaded = [...new Set(loadedLists.flat())];
            liveHealth.gpu = await gpuLiveStats();
            // Only advertise a plugin while it's actually answering (and it came up) — so a
            // crashed/hung instance stops being advertised to clients. Guard on `wasUp`, NOT
            // `pid`: a child that died between boot and now has a null pid but must still be
            // re-probed to flip its stale advertisement off (probe() handles the null child).
            for (const svc of services) { if (svc.wasUp) liveHealth[svc.healthKey] = await svc.probe(config); }
            liveHealth.plugins = pluginsSummary(services, config);
            liveHealth.clientsConnected = freshClients().length; // decay the count when pings stop
            if (beacon) beacon.kick();
        } catch { /* probes are already failure-tolerant; never throw from the timer */ }
        finally { healthInFlight = false; }
    }, Math.max(10, config.beacon.intervalSec * 2) * 1000);
    if (healthTimer.unref) healthTimer.unref();

    // 6. Record runtime so status/down work from another shell. Wrapped so a live
    //    proxy restart (control.restartProxy) can refresh the recorded litellmPid —
    //    otherwise `lol down` from another shell would kill the stale (old) pid and
    //    leave the bounced LiteLLM running.
    const startedAt = Date.now();
    const writeRuntimeState = () => writeRuntime({
        litellmPid: child.pid,
        searxngPid: svcById.websearch.pid,
        kokoroPid: svcById.tts.pid,
        extractPid: svcById.ocr.pid,
        ollamaPids: oll.spawnedPids,
        proxyPort: config.proxy.port,
        endpoint: snapshot.endpoint,
        openaiBaseUrl: snapshot.openaiBaseUrl,
        configPath,
        farmId: snapshot.id,
        startedAt,
        host: os.hostname(),
    });
    writeRuntimeState();

    log.plain('');
    log.ok(`${log.paint.bold(config.name)} is up${coordinator ? ' (coordinator)' : ''}.`);
    log.plain(`     OpenAI endpoint : ${log.paint.cyan(snapshot.openaiBaseUrl)}`);
    if (coordinator) log.plain(`     Coordinator     : balancing ${log.paint.bold(String(backends))} backend(s) — ${config.ollama.hosts.length} local host + ${peers.length} peer farm(s)`);
    log.plain(`     Reachable at    : ${snapshot.ips.map((ip) => `http://${ip}:${config.proxy.port}/v1`).join('  ')}`);
    log.plain(`     Admin panel     : ${log.paint.cyan(`http://${snapshot.ips[0] || '127.0.0.1'}:${config.beacon.httpPort}/lol/admin`)}   token ${log.paint.bold(adminToken)}`);
    log.plain(`     Stop with       : Ctrl-C   (or \`lol down\` from another shell)`);
    log.plain('');

    // 7. Supervise in the foreground.
    let stopping = false;
    const shutdown = async (sig) => {
        if (stopping) return;
        stopping = true;
        log.plain('');
        log.step(`Stopping (${sig}) …`);
        clearInterval(healthTimer);
        if (beacon) beacon.stop();
        try { selfServer.close(); } catch { /* already closed */ }
        await killTree(child.pid);
        for (const svc of services) { if (svc.pid) await killTree(svc.pid); }
        for (const pid of oll.spawnedPids) await killTree(pid);
        clearRuntime();
        log.ok('Farm stopped.');
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // The proxy-exit handler is NAMED so a deliberate restart (restartProxy, below)
    // can bounce LiteLLM without this treating it as a crash and tearing the farm down.
    // Guards: `restartingProxy` (we're deliberately bouncing) and identity (`c !== child`,
    // a superseded old child) both suppress the teardown.
    const onProxyExit = async (c, code) => {
        if (restartingProxy || c !== child || stopping) return;
        stopping = true;
        // Tear down everything we own BEFORE exiting (and AWAIT the Ollama kills so
        // process.exit doesn't orphan a local Ollama this CLI started).
        clearInterval(healthTimer);
        if (beacon) beacon.stop();
        try { selfServer.close(); } catch { /* already closed */ }
        // If the runtime file is already gone, `lol down` (another shell) cleared
        // it before killing us — an intentional stop, so exit quietly.
        const intentional = !readRuntime();
        if (intentional) { log.plain(''); log.ok('Farm stopped (via `lol down`).'); }
        else { log.err(`LiteLLM exited unexpectedly (code ${code}). Shutting down the farm.`); clearRuntime(); }
        for (const svc of services) { if (svc.pid) await killTree(svc.pid); }
        for (const pid of oll.spawnedPids) await killTree(pid);
        process.exit(intentional ? 0 : (code || 1));
    };
    // Bind the exit handler capturing the SPECIFIC child instance (`c`), so onProxyExit's
    // identity guard (`c !== child`) can actually tell a superseded old child from the
    // current one — a bare `onProxyExit(child, …)` would read the `let` at call time and
    // always see the current child, defeating the guard.
    const bindProxyExit = (c) => c.on('exit', (code) => onProxyExit(c, code));
    bindProxyExit(child);

    // --- live admin control (start/stop models) ---------------------------------
    // Regenerate the LiteLLM routing for the current in-memory config.models and bounce
    // the proxy child in place. LiteLLM here is config-only (no DB), so its /model/new
    // admin route is unavailable — a restart is the reliable way to change the served
    // set. Brief blip: in-flight requests drop during the few seconds it takes to come
    // back. Guarded by restartingProxy so onProxyExit doesn't tear the farm down.
    // Returns true ONLY when the new proxy actually became healthy.
    async function restartProxy() {
        if (stopping) return false;
        restartingProxy = true;
        try {
            writeLitellmConfig(config, yamlPath, peers);
            await killTree(child.pid);
            if (stopping) return false;                    // a signal landed during the kill → don't spawn an orphan
            const nc = spawnLitellm(config, yamlPath);
            let ncExited = false;
            nc.on('error', () => { /* a failed spawn surfaces via waitForProxy below */ });
            // Records a startup death AND (once healthy + current) supervises like the
            // initial child. Suppressed while restartingProxy / superseded (identity).
            nc.on('exit', (code) => { ncExited = true; onProxyExit(nc, code); });
            wireProxyIo(nc);
            child = nc;
            writeRuntimeState();                           // record the new pid immediately so `lol down` targets it
            const ok = await proxyApi.waitForProxy(baseUrl, { timeoutMs: 90000 });
            if (stopping) return false;
            if (!ok || ncExited) {                         // the new proxy never came up — don't leave a zombie
                log.err('Proxy restart failed — the new LiteLLM did not become healthy.');
                await killTree(nc.pid);
                return false;
            }
            return true;
        } finally {
            restartingProxy = false;
        }
    }

    // Apply an in-memory config.models change + bounce the proxy; on failure ROLL BACK to
    // the previous set and restore the last-known-good proxy (a failed model change must
    // never leave the farm without a working proxy). EPHEMERAL — never writes
    // lol.config.json (matches the `lol up` picker, which deliberately doesn't persist).
    async function applyModels(next) {
        const before = config.models;
        config.models = next;
        if (await restartProxy()) return true;
        config.models = before;                            // revert
        await restartProxy();                              // it was healthy before → restore it
        return false;
    }
    const norm = (s) => String(s || '').replace(/:latest$/, '');   // gemma4 ≡ gemma4:latest
    const servedIdList = () => config.models.map((m) => m.id);

    async function startModel(id) {
        id = String(id || '').trim();
        if (!id) return { ok: false, error: 'No model id.' };
        if (config.models.some((m) => norm(m.id) === norm(id))) return { ok: true, already: true, servedModels: servedIdList() };
        const present = (await Promise.all(oll.reachable.map((h) => ollama.listModels(h)))).flat();
        if (!ollama.hasModel(present, id)) return { ok: false, error: `"${id}" isn't installed on any reachable host — pull it first.` };
        if (!(await applyModels(config.models.concat([{ id }])))) {
            return { ok: false, error: 'The proxy did not come back — reverted to the previous model set.', servedModels: servedIdList() };
        }
        for (const h of oll.reachable.filter(isLocalHost)) ollama.warmModel(h, id, config.ollama.keepAlive, config.ollama.contextLength).catch(() => {});
        if (beacon) beacon.kick();
        return { ok: true, servedModels: servedIdList() };
    }
    async function stopModel(id) {
        id = String(id || '').trim();
        const idx = config.models.findIndex((m) => norm(m.id) === norm(id));
        if (idx < 0) return { ok: true, already: true, servedModels: servedIdList() };
        if (config.models.length <= 1) return { ok: false, error: 'Cannot stop the last served model.' };
        const removed = config.models[idx];
        const next = config.models.slice();
        next.splice(idx, 1);
        // Promote a new default without mutating the shared entry object (rollback safety).
        if (removed.default && !next.some((m) => m.default)) next[0] = { ...next[0], default: true };
        if (!(await applyModels(next))) {
            return { ok: false, error: 'The proxy did not come back — reverted to the previous model set.', servedModels: servedIdList() };
        }
        for (const h of oll.reachable.filter(isLocalHost)) ollama.evictModel(h, removed.id).catch(() => {});
        if (beacon) beacon.kick();
        return { ok: true, servedModels: servedIdList() };
    }

    // A richer view than the discovery snapshot: installed models per host (with sizes),
    // which are served, which are loaded in VRAM, + host/plugin health. Drives the page.
    async function getAdminState() {
        const perHost = await Promise.all(hosts.map(async (h) => ({
            installed: await ollama.listModelsDetailed(h),
            loaded: await ollama.loadedModels(h),
        })));
        const installed = new Map();
        for (const ph of perHost) for (const m of ph.installed) if (!installed.has(m.name)) installed.set(m.name, m);
        const loaded = [...new Set(perHost.flatMap((ph) => ph.loaded))];
        // Match on the normalized id (gemma4 ≡ gemma4:latest) so an untagged config
        // entry still flags the fully-tagged Ollama name as served/default — same
        // tolerance startModel/stopModel use, so the page shows the right Start/Stop.
        const servedIds = new Set(config.models.map((m) => norm(m.id)));
        const defaultId = norm((config.models.find((m) => m.default) || config.models[0] || {}).id || null);
        return {
            name: config.name,
            models: [...installed.values()].map((m) => ({
                id: m.name, size: m.size, family: m.family, paramSize: m.paramSize,
                served: servedIds.has(norm(m.name)), loaded: loaded.includes(m.name), isDefault: norm(m.name) === defaultId,
            })),
            servedNames: servedEntries(config).map((e) => e.servedName),
            modelAlias: (config.modelAlias || '').trim() || null,
            contextLength: config.ollama.contextLength,
            plugins: pluginsSummary(services, config),
            recommendedClientPlugins: config.recommendedClientPlugins || [],
            clients: freshClients(),   // desktop clients heartbeating us (most-active first)
            health: {
                hostsUp: liveHealth.hostsUp, hostsTotal: config.ollama.hosts.length,
                gpu: liveHealth.gpu || null, host: liveHealth.host || null, proxyUp: liveHealth.proxyUp !== false,
            },
        };
    }

    // Make a served model the DEFAULT: drives the snapshot's models[].default, which
    // every client feeds to OWUI as DEFAULT_MODELS (auto-selected model) — so this is
    // "pick what the fleet chats with by default". The proxy only needs a bounce in
    // global-alias mode (the alias binds to the default's underlying model); otherwise
    // the generated routing is unchanged and only the beacon needs a kick.
    async function setDefaultModel(id) {
        id = String(id || '').trim();
        const target = config.models.find((m) => norm(m.id) === norm(id));
        if (!target) return { ok: false, error: `"${id}" isn't a served model — start it first.`, servedModels: servedIdList() };
        if (target.default) return { ok: true, already: true, defaultModel: target.id };
        const next = config.models.map((m) => ({ ...m, default: norm(m.id) === norm(id) }));
        if ((config.modelAlias || '').trim()) {
            // Alias mode: the alias re-binds to the new default → routing changes.
            if (!(await applyModels(next))) {
                return { ok: false, error: 'The proxy did not come back — kept the previous default.', servedModels: servedIdList() };
            }
        } else {
            config.models = next;
        }
        for (const h of oll.reachable.filter(isLocalHost)) ollama.warmModel(h, target.id, config.ollama.keepAlive, config.ollama.contextLength).catch(() => {});
        if (beacon) beacon.kick();
        return { ok: true, defaultModel: target.id, servedModels: servedIdList() };
    }

    // Change the model context window (num_ctx) live: it rides the generated LiteLLM
    // routing (litellm.js injects it per deployment), so applying = regenerate +
    // bounce the proxy — same guarded machinery as a model change, same rollback.
    // Ephemeral like every panel change; persist via ollama.contextLength in
    // lol.config.json. Ollama reloads a model on first request at a new num_ctx, so
    // the default model is re-warmed at the new size to hide that latency.
    async function setContextLength(tokens) {
        const n = Math.round(Number(tokens));
        if (!Number.isFinite(n) || n < 2048 || n > 262144) {
            return { ok: false, error: 'Context must be between 2048 and 262144 tokens.', contextLength: config.ollama.contextLength };
        }
        if (n === config.ollama.contextLength) return { ok: true, already: true, contextLength: n };
        const before = config.ollama.contextLength;
        config.ollama.contextLength = n;
        if (!(await restartProxy())) {
            config.ollama.contextLength = before;          // revert
            await restartProxy();                          // it was healthy before → restore it
            return { ok: false, error: 'The proxy did not come back — kept the previous context size.', contextLength: before };
        }
        const def = (config.models.find((m) => m.default) || config.models[0] || {}).id;
        if (def) for (const h of oll.reachable.filter(isLocalHost)) ollama.warmModel(h, def, config.ollama.keepAlive, n).catch(() => {});
        if (beacon) beacon.kick();
        return { ok: true, contextLength: n };
    }

    // Toggle a FARM plugin (web search / voice / OCR) live: spawn or kill its service child,
    // reflect into liveHealth, kick the beacon so clients pick up the change. Ephemeral (the
    // config.<plugin>.enabled flip isn't persisted — matches the model-change philosophy).
    async function setPlugin(id, on) {
        const svc = svcById[id];
        if (!svc) return { ok: false, error: `Unknown plugin "${id}".` };
        on = !!on;
        config[svc.configKey].enabled = on;
        if (on) {
            if (svc.pid) return { ok: true, already: true, enabled: true, healthy: svc.up };
            await bringUp(svc);
            if (!svc.up) {
                // Came up unhealthy (e.g. SearXNG's JSON API off / Kokoro synth failed) but the
                // child may still be ALIVE — tear it down so we don't leak an unmanaged process,
                // then roll back the intent.
                config[svc.configKey].enabled = false;
                await bringDown(svc);
                writeRuntimeState();
                return { ok: false, error: `${svc.label} did not come up — see the farm log.` };
            }
        } else {
            await bringDown(svc);
        }
        writeRuntimeState();       // service pids changed → keep `lol down` accurate
        if (beacon) beacon.kick();
        return { ok: true, enabled: on, healthy: svc.up };
    }
    // Recommend (or un-recommend) a CLIENT-side plugin (e.g. "blender") to the fleet — the
    // farm can't run it, only advertise the intent; clients auto-apply what they can.
    function recommendClientPlugin(id, on) {
        id = String(id || '').trim();
        if (!id) return { ok: false, error: 'No plugin id.' };
        const set = new Set(config.recommendedClientPlugins || []);
        if (on) set.add(id); else set.delete(id);
        config.recommendedClientPlugins = [...set];
        if (beacon) beacon.kick();
        return { ok: true, recommendedClientPlugins: config.recommendedClientPlugins };
    }

    // Serialize mutations: the admin page's client-side `busy` flag doesn't bind a second
    // browser tab, another device sharing the token, or a curl script, and two overlapping
    // restarts share `restartingProxy` — one's finally clears it while the other is still
    // mid-restart, which could unmask onProxyExit and tear the farm down. A single in-flight
    // chain makes start/stop/plugin-toggle atomic regardless of how many callers hit at once.
    let mutating = Promise.resolve();
    const serialize = (fn) => { const p = mutating.then(fn, fn); mutating = p.catch(() => {}); return p; };
    Object.assign(control, {
        getAdminState,                                     // read-only — no lock needed
        startModel: (id) => serialize(() => startModel(id)),
        stopModel: (id) => serialize(() => stopModel(id)),
        setDefaultModel: (id) => serialize(() => setDefaultModel(id)),
        setContextLength: (n) => serialize(() => setContextLength(n)),
        setPlugin: (id, on) => serialize(() => setPlugin(id, on)),
        recommendClientPlugin,                             // trivial array mutation + kick
    });

    // Keep the event loop alive.
    return new Promise(() => {});
}

module.exports = { run, resolveOcrModel };
