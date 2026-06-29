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
    return {
        v: 1,
        id: farmId(),
        name: config.name,
        proxyPort,
        ips,
        endpoint,                                  // OpenAI root (LiteLLM serves /v1 + bare)
        openaiBaseUrl: `${endpoint}/v1`,           // exactly what OWUI's OPENAI_API_BASE_URL wants
        requiresKey: !!config.proxy.masterKey,
        models: config.models.map((m) => ({ id: m.id, default: !!m.default })),
        healthy: health.proxyUp !== false && (health.hostsUp == null || health.hostsUp > 0),
        version: PKG_VERSION,
        // Per-host / proxy detail, useful for `lol status` and the client cards.
        health: {
            proxyUp: health.proxyUp ?? null,
            hostsUp: health.hostsUp ?? null,
            hostsTotal: health.hostsTotal ?? config.ollama.hosts.length,
            loaded: health.loaded ?? [],
        },
        ts: Date.now(),
    };
}

module.exports = { buildSnapshot, PKG_VERSION };
