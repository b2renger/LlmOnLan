// `lol status` — health of each Ollama host + the proxy + loaded models.
// Works from any shell (reads .lol-runtime.json + live-probes the services).

const log = require('../log');
const ollama = require('../ollama');
const proxyApi = require('../proxy');
const { loadConfig } = require('../config');
const { readRuntime, isAlive } = require('../proc');
const { detectHardware, gpuLiveStats } = require('../systemInfo');

function hostLabel(h) { try { return new URL(h).host; } catch { return h; } }

async function run() {
    let config;
    try { ({ config } = loadConfig()); }
    catch (e) { log.err(e.message); return 1; }

    log.info(`Status — ${log.paint.bold(config.name)}`);

    // ---- Hardware ----
    const [hw, gpu] = await Promise.all([detectHardware(), gpuLiveStats()]);
    const gpuLive = gpu.gpuUtil != null
        ? `   ${log.paint.cyan(`${gpu.gpuUtil}% util`)} · ${gpu.vramUsedGb}/${gpu.vramTotalGb}GB VRAM used`
        : '';
    log.plain(`  ${log.paint.bold('Hardware:')} ${hw.gpu} · ${hw.vramGb}GB VRAM · ${hw.ramGb}GB RAM · ${hw.cpuCores} cores${gpuLive}`);

    // ---- Ollama hosts ----
    const hosts = config.ollama.hosts.map(ollama.normalizeHost);
    log.plain(log.paint.bold('  Ollama hosts:'));
    await Promise.all(hosts.map(async (h) => {
        const v = await ollama.version(h);
        if (!v) { log.plain(`    ${log.paint.red('●')} ${hostLabel(h)} — ${log.paint.red('unreachable')}`); return; }
        const loaded = await ollama.loadedModels(h);
        const present = await ollama.listModels(h);
        const have = config.models.filter((m) => ollama.hasModel(present, m.id)).map((m) => m.id);
        log.plain(
            `    ${log.paint.green('●')} ${hostLabel(h)} — v${v}` +
            `   present: ${have.length ? have.join(', ') : log.paint.grey('none of the catalog')}` +
            `   loaded: ${loaded.length ? log.paint.cyan(loaded.join(', ')) : log.paint.grey('idle')}`
        );
    }));

    // ---- Proxy ----
    const rt = readRuntime();
    const baseUrl = `http://127.0.0.1:${config.proxy.port}`;
    log.plain(log.paint.bold('  Proxy:'));
    const live = await proxyApi.proxyLive(baseUrl);
    if (live) {
        const served = await proxyApi.listProxyModels(baseUrl, config.proxy.masterKey);
        const pidNote = rt && isAlive(rt.litellmPid) ? `pid ${rt.litellmPid}` : 'running (not started by this CLI)';
        log.plain(`    ${log.paint.green('●')} LiteLLM up @ ${baseUrl}/v1 (${pidNote})   models: ${served.length ? served.join(', ') : log.paint.grey('none')}`);
    } else if (rt && isAlive(rt.litellmPid)) {
        log.plain(`    ${log.paint.yellow('●')} LiteLLM pid ${rt.litellmPid} alive but not answering yet @ ${baseUrl}`);
    } else {
        log.plain(`    ${log.paint.grey('●')} not running — start with ${log.paint.cyan('lol up')}`);
    }

    if (rt) {
        log.plain(log.paint.grey(`  (runtime: started ${new Date(rt.startedAt).toLocaleString()}, endpoint ${rt.openaiBaseUrl})`));
    }
    return 0;
}

module.exports = { run };
