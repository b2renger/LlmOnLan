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
const { servedEntries } = require('./litellm');
const { farmId } = require('./identity');

const PKG_VERSION = require('../package.json').version;

// The llama.cpp backend's advertised entry, or null when disabled. `underlying`
// is the GGUF's basename so client cards can show the real weights even though
// every box shares an alias like "assistant".
function llamacppServedModel(config) {
    const lc = config.llamacpp || {};
    if (!lc.enabled) return null;
    let underlying = 'llama.cpp';
    if (lc.model) {
        try {
            underlying = decodeURIComponent(new URL(lc.model).pathname.split('/').pop() || '')
                .replace(/\.gguf$/i, '') || 'llama.cpp';
        } catch { /* not a URL — keep the generic label */ }
    }
    return { id: lc.alias, underlying, default: true };
}

// `health` is { proxyUp, hostsUp, hostsTotal, loaded } as gathered by status/up.
function buildSnapshot(config, health = {}) {
    const ips = lanAddresses();
    const proxyPort = config.proxy.port;
    const primary = primaryAddress();
    const endpoint = `http://${primary}:${proxyPort}`;
    // Advertise what clients actually SEE on /v1/models — the SERVED names (per-
    // model alias / global modelAlias / raw id), derived from the same
    // servedEntries() that generates the LiteLLM routing, so advertising and
    // routing can't drift. Stable alias ids are what let OWUI chats survive
    // underlying-model swaps.
    // `id` is the SERVED name (alias in alias mode); `underlying` is the real Ollama
    // model behind it, so the client can show "what model actually runs on this box"
    // even when every box shares one alias like "assistant".
    //
    // When the llama.cpp backend is enabled it OWNS its alias in the generated
    // LiteLLM routing (buildLitellmConfig), so it must own it here too — above all
    // `default`, which is what OWUI's DEFAULT_MODELS and LOL Chat's picker
    // auto-select. Advertising an Ollama model as default while llama-server holds
    // ~10.6 GB of a 12 GB card sends every client to a second model that cannot fit
    // — VRAM overcommit, WDDM paging, tokens crawl. Ollama models stay selectable,
    // but never default while llamacpp is on.
    const lcModel = llamacppServedModel(config);
    const models = servedEntries(config)
        .filter((e) => !(lcModel && e.servedName === lcModel.id))
        .map((e) => ({ id: e.servedName, underlying: e.underlying, default: lcModel ? false : e.isDefault }));
    if (lcModel) models.unshift(lcModel);
    return {
        v: 1,
        id: farmId(),
        name: config.name,
        proxyPort,
        // The admin/control HTTP port (GET /lol/self + the /lol/admin page live here), so a
        // client can open the panel at http://<host>:<httpPort>/lol/admin.
        httpPort: config.beacon.httpPort,
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
        // Shared SearXNG metasearch on this box (null when off/down). Clients set
        // OWUI's SEARXNG_QUERY_URL from this — web search with zero client setup.
        searxngUrl: (config.websearch?.enabled && health.searxngUp)
            ? `http://${primary}:${config.websearch.port}`
            : null,
        // Shared Kokoro TTS on this box (null when off/down). Clients set OWUI's
        // AUDIO_TTS_* from these — neural read-aloud/voice with zero client setup.
        // ttsUrl already includes /v1 (what AUDIO_TTS_OPENAI_API_BASE_URL wants).
        ttsUrl: (config.tts?.enabled && health.ttsUp)
            ? `http://${primary}:${config.tts.port}/v1`
            : null,
        ttsVoice: (config.tts?.enabled && health.ttsUp) ? config.tts.voice : null,
        ttsModel: (config.tts?.enabled && health.ttsUp) ? config.tts.model : null,
        // Shared OCR / document-extraction on this box (null when off/down). Clients
        // set OWUI's CONTENT_EXTRACTION_ENGINE=external + EXTERNAL_DOCUMENT_LOADER_URL
        // from `url` and the required key from `key` — scanned-doc + image OCR with
        // zero client setup. `url` is the loader BASE (OWUI appends /process itself).
        extract: (config.ocr?.enabled && health.extractUp && health.extractKey)
            ? { url: `http://${primary}:${config.ocr.port}`, key: health.extractKey }
            : null,
        // Farm-side plugin state (web search / voice / OCR): { id: {label, runsOn, enabled,
        // healthy} }. Bespoke fields above (searxngUrl/ttsUrl/extract) stay for back-compat;
        // this is the generic map the admin page + clients read.
        plugins: health.plugins || {},
        // Client-side plugins (e.g. "blender") the farm RECOMMENDS — clients auto-apply what
        // they can run. The farm can't toggle a per-client plugin, only advertise the intent.
        recommendedClientPlugins: Array.isArray(config.recommendedClientPlugins) ? config.recommendedClientPlugins : [],
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
            // Desktop clients currently heartbeating this farm (POST /lol/client-ping).
            clients: health.clientsConnected ?? null,
        },
        ts: Date.now(),
    };
}

module.exports = { buildSnapshot, PKG_VERSION };
