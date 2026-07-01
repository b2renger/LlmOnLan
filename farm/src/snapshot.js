// The discovery snapshot — the small JSON the farm advertises.
//
// Carried two ways (built ONCE here so they can't drift, mirroring ComfyQ's
// buildSnapshot shared by its beacon + /federation/self):
//   • UDP beacon  (broadcast/multicast, M3)
//   • GET /lol/self  (unicast HTTP fallback for broadcast-blocked LANs, M3)
//
// Shape (v=1): { v, id, name, proxyPort, ips, endpoint, openaiBaseUrl,
//                requiresKey, models, healthy, version, ts }

const { lanAddresses, primaryAddress } = require('./net');
const { farmId } = require('./identity');

const PKG_VERSION = require('../package.json').version;

// `health` is { proxyUp, hostsUp, hostsTotal, loaded } as gathered by status/up.
function buildSnapshot(config, health = {}) {
    const ips = lanAddresses();
    const proxyPort = config.proxy.port;
    const primary = primaryAddress();
    const endpoint = `http://${primary}:${proxyPort}`;
    // Advertise what clients actually SEE on /v1/models: in alias mode the fixed
    // alias id (backed by the picked model); otherwise the real catalog. Keeping this
    // aligned with the generated LiteLLM model_name is what makes the client's
    // DEFAULT_MODELS + OWUI chats bind to a stable id across picker changes.
    const alias = (config.modelAlias || '').trim();
    const models = alias
        ? [{ id: alias, default: true }]
        : config.models.map((m) => ({ id: m.id, default: !!m.default }));
    return {
        v: 1,
        id: farmId(),
        name: config.name,
        proxyPort,
        ips,
        endpoint,                                  // OpenAI root (LiteLLM serves /v1 + bare)
        openaiBaseUrl: `${endpoint}/v1`,           // exactly what OWUI's OPENAI_API_BASE_URL wants
        requiresKey: !!config.proxy.masterKey,
        models,
        healthy: health.proxyUp !== false && (health.hostsUp == null || health.hostsUp > 0),
        version: PKG_VERSION,
        // Coordinator mode: this farm aggregates peers into one balanced proxy, so
        // clients should prefer it over the individual box-farms (see the shell's
        // pickLeastLoaded). Absent/false on a normal single-box farm.
        coordinator: !!health.coordinator,
        // How many balanced deployments back this endpoint (local Ollama hosts +
        // aggregated peers). Informational, for `lol fleet` / client cards.
        deployments: health.deployments ?? null,
        // Per-host / proxy detail, useful for `lol status` and the client cards.
        health: {
            proxyUp: health.proxyUp ?? null,
            hostsUp: health.hostsUp ?? null,
            hostsTotal: health.hostsTotal ?? config.ollama.hosts.length,
            loaded: health.loaded ?? [],
        },
        // Static hardware (detected once at boot): { gpu, vramGb, ramGb, cpuCores }.
        host: health.host || null,
        // Live-ish usage (refreshed by the farm's health timer): GPU + loaded models.
        usage: {
            gpuUtil: health.gpu?.gpuUtil ?? null,
            vramUsedGb: health.gpu?.vramUsedGb ?? null,
            vramTotalGb: health.gpu?.vramTotalGb ?? null,
            loaded: health.loaded ?? [],
        },
        ts: Date.now(),
    };
}

module.exports = { buildSnapshot, PKG_VERSION };
