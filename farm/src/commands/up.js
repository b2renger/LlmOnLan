// `lol up` (alias `lol serve`) — bring the farm online from lol.config.json.
//
// Steps: ensure each Ollama host is reachable → pull configured models →
// generate the LiteLLM config.yaml → start + health-wait the proxy → (M3) start
// the discovery beacon → supervise in the foreground until Ctrl-C.
//
// Runs in the foreground and writes .lol-runtime.json so `lol status` / `lol down`
// work from another shell.

const os = require('os');
const { spawn } = require('child_process');
const log = require('../log');
const ollama = require('../ollama');
const proxyApi = require('../proxy');
const { loadConfig } = require('../config');
const { writeLitellmConfig } = require('../litellm');
const { buildSnapshot } = require('../snapshot');
const {
    readRuntime, writeRuntime, clearRuntime, isAlive, killTree, spawnLitellm,
} = require('../proc');

const LOCAL_RX = /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i;

function isLocalHost(baseUrl) {
    try { return LOCAL_RX.test(new URL(baseUrl).hostname); } catch { return false; }
}

// Spawn a local `ollama serve` with the configured concurrency env. Returns the
// child pid, or null if it couldn't be started. Only used when a LOCAL host is
// down — we never touch a remote box or an already-running local Ollama.
function spawnLocalOllama(config, baseUrl) {
    const env = {
        OLLAMA_NUM_PARALLEL: String(config.ollama.numParallel),
        OLLAMA_MAX_LOADED_MODELS: String(config.ollama.maxLoadedModels),
        OLLAMA_FLASH_ATTENTION: config.ollama.flashAttention ? '1' : '0',
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
            `Note: set on each Ollama service to apply concurrency — ` +
            `OLLAMA_NUM_PARALLEL=${config.ollama.numParallel} ` +
            `OLLAMA_MAX_LOADED_MODELS=${config.ollama.maxLoadedModels} ` +
            `OLLAMA_FLASH_ATTENTION=${config.ollama.flashAttention ? 1 : 0}`
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

async function run(args) {
    let config, configPath;
    try { ({ config, path: configPath } = loadConfig()); }
    catch (e) { log.err(e.message); return 1; }

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

    // 2. Models
    await pullMissing(config, oll.reachable);

    // 3. Generate LiteLLM config from lol.config.json (routing is derived).
    const yamlPath = writeLitellmConfig(config);
    log.ok(`Generated LiteLLM routing → ${log.paint.grey(yamlPath)} (${config.models.length} model × ${config.ollama.hosts.length} host deployments)`);

    // 4. Start + health-wait the proxy.
    const baseUrl = `http://127.0.0.1:${config.proxy.port}`;
    log.step(`Starting LiteLLM proxy on ${config.proxy.host}:${config.proxy.port} …`);
    const child = spawnLitellm(config, yamlPath);
    let spawnFailed = false;
    child.on('error', (e) => {
        spawnFailed = true;
        if (e.code === 'ENOENT') {
            log.err(`LiteLLM not found ('${config.litellm.command}'). Install it (pip install 'litellm[proxy]') or set litellm.command in lol.config.json.`);
        } else {
            log.err(`Failed to start LiteLLM: ${e.message}`);
        }
    });
    child.stdout.on('data', log.childPrefix('litellm'));
    child.stderr.on('data', log.childPrefix('litellm'));

    const up = await proxyApi.waitForProxy(baseUrl, { timeoutMs: 90000 });
    if (spawnFailed) return 1;
    if (!up) {
        log.err('LiteLLM did not become healthy in time. Check the [litellm] logs above.');
        await killTree(child.pid);
        return 1;
    }

    const served = await proxyApi.listProxyModels(baseUrl, config.proxy.masterKey);
    log.ok(`Proxy healthy — ${log.paint.bold('/v1/models')}: ${served.length ? served.join(', ') : '(none yet)'}`);

    // 5. Discovery beacon — wired in M3. (Snapshot is already buildable.)
    const snapshot = buildSnapshot(config, { proxyUp: true, hostsUp: oll.reachable.length, hostsTotal: config.ollama.hosts.length });
    log.info(`Discovery beacon: ${log.paint.grey('enabled in M3')} (snapshot id ${snapshot.id.slice(0, 8)})`);

    // 6. Record runtime so status/down work from another shell.
    writeRuntime({
        litellmPid: child.pid,
        ollamaPids: oll.spawnedPids,
        proxyPort: config.proxy.port,
        endpoint: snapshot.endpoint,
        openaiBaseUrl: snapshot.openaiBaseUrl,
        configPath,
        farmId: snapshot.id,
        startedAt: Date.now(),
        host: os.hostname(),
    });

    log.plain('');
    log.ok(`${log.paint.bold(config.name)} is up.`);
    log.plain(`     OpenAI endpoint : ${log.paint.cyan(snapshot.openaiBaseUrl)}`);
    log.plain(`     Reachable at    : ${snapshot.ips.map((ip) => `http://${ip}:${config.proxy.port}/v1`).join('  ')}`);
    log.plain(`     Stop with       : Ctrl-C   (or \`lol down\` from another shell)`);
    log.plain('');

    // 7. Supervise in the foreground.
    let stopping = false;
    const shutdown = async (sig) => {
        if (stopping) return;
        stopping = true;
        log.plain('');
        log.step(`Stopping (${sig}) …`);
        await killTree(child.pid);
        for (const pid of oll.spawnedPids) await killTree(pid);
        clearRuntime();
        log.ok('Farm stopped.');
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    child.on('exit', (code) => {
        if (stopping) return;
        // If the runtime file is already gone, `lol down` (from another shell)
        // cleared it before killing us — an intentional stop, so exit quietly.
        if (!readRuntime()) {
            log.plain('');
            log.ok('Farm stopped (via `lol down`).');
            for (const pid of oll.spawnedPids) killTree(pid);
            process.exit(0);
        }
        log.err(`LiteLLM exited unexpectedly (code ${code}). Shutting down the farm.`);
        clearRuntime();
        for (const pid of oll.spawnedPids) killTree(pid);
        process.exit(code || 1);
    });

    // Keep the event loop alive.
    return new Promise(() => {});
}

module.exports = { run };
