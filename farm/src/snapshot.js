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
const GGUF_EXT = new RegExp(String.raw`\.gguf$`, 'i');

// The GGUF's basename, so a client card can show the real weights even though
// every box shares an alias like "assistant". Falls back to a generic label when
// `model` is unset or not a URL (an operator can point llamacpp.model at a path).
function ggufName(url) {
    if (!url) return 'llama.cpp';
    try {
        const base = decodeURIComponent(new URL(url).pathname.split('/').pop() || '');
        return base.replace(GGUF_EXT, '') || 'llama.cpp';
    } catch { return 'llama.cpp'; }   // not a URL — keep the generic label
}

// The llama.cpp backend's advertised entry, or null when disabled.
function llamacppServedModel(config) {
    const lc = config.llamacpp || {};
    if (!lc.enabled) return null;
    return { id: lc.alias, underlying: ggufName(lc.model), default: true };
}

// Which engine actually answers the model clients auto-select, and how many people
// it can answer AT ONCE. Both were previously invisible: the snapshot carried a
// model id and nothing about what was behind it, so neither a client nor the admin
// panel could tell a llama.cpp farm from an Ollama one — or say "this box is full".
//
// Slots differ per engine, and the difference is not cosmetic:
//   • llama.cpp — `parallel` slots, and --ctx-size is SPLIT across them (verified:
//     --ctx-size 16384 --parallel 2 -> n_ctx_slot 8192). Raising slots therefore
//     SHRINKS every user's context window, so contextPerSlot is what a user gets.
//   • Ollama — numParallel requests per host, so capacity scales with reachable
//     hosts and each request keeps the full num_ctx.
function backendInfo(config, health = {}) {
    const lc = config.llamacpp || {};
    if (lc.enabled) {
        const slots = Math.max(1, lc.parallel || 1);
        return {
            engine: 'llama.cpp',
            alias: lc.alias,
            model: ggufName(lc.model),
            contextLength: lc.contextLength,
            contextPerSlot: Math.floor((lc.contextLength || 0) / slots),
            slots,
            mtp: !!lc.mtp,
            kvCacheType: lc.kvCacheType || 'f16',
        };
    }
    const entries = servedEntries(config);
    const def = entries.find((e) => e.isDefault) || entries[0] || {};
    const hosts = health.hostsUp || config.ollama.hosts.length || 1;
    const slots = Math.max(1, (config.ollama.numParallel || 1) * hosts);
    return {
        engine: 'ollama',
        alias: def.servedName || null,
        model: def.underlying || null,
        contextLength: config.ollama.contextLength,
        contextPerSlot: config.ollama.contextLength,   // Ollama does not split its context
        slots,
        mtp: false,
        kvCacheType: 'f16',
    };
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
    // One computation, two readers (`backend` + `capacity`) — backendInfo walks
    // servedEntries() in Ollama mode, which is not free to do twice per beacon tick.
    let _backend = null;
    const backend = () => (_backend || (_backend = backendInfo(config, health)));
    // ONE engine at a time (owner decision, 2026-08-26): while llama.cpp serves,
    // its alias is the ONLY advertised model — the Ollama catalog is standby
    // inventory, not routed and not shown to clients (it used to stay selectable,
    // which read as "both engines are running" and let a picked Ollama model
    // overcommit a 12 GB card already holding llama-server).
    const lcModel = llamacppServedModel(config);
    const models = lcModel
        ? [lcModel]
        : servedEntries(config).map((e) => ({ id: e.servedName, underlying: e.underlying, default: e.isDefault }));
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
        // Which engine answers, on what weights — so a client card can say
        // "llama.cpp · Qwen3.8-27B-UD-IQ2_S" instead of repeating the alias back at
        // the user, and so the admin panel can show which backend is live.
        backend: backend(),
        // How many people this box serves at once, vs how many are on it right now.
        // Deliberately ADVISORY: nothing refuses a client past `slots`, because a farm
        // that turned people away would be worse than one that queues them. The client
        // renders "2 of 2 slots in use" so the next person can choose another box.
        capacity: {
            slots: backend().slots,
            clients: health.clientsConnected ?? 0,
            // Live load when the engine reports it (llama.cpp /metrics): requests
            // generating right now, and requests waiting for a slot.
            busy: health.perf?.busySlots ?? null,
            queued: health.perf?.queued ?? null,
        },
        // The one long admin operation in flight (model download / backend switch /
        // reload), or null. Clients read it to say "the server is switching models —
        // a moment" instead of surfacing a raw connection error while the proxy
        // bounces. health.getJob is a thunk so every beacon tick sees live progress.
        busy: (typeof health.getJob === 'function' ? health.getJob() : null) || null,
        // Measured performance (llama.cpp engine only): true tok/s while generating,
        // sticky last-active rate, prompt speed, KV usage. null on Ollama or before
        // the first sample. The panel renders it; `lol status` and clients may too.
        perf: health.perf || null,
        ts: Date.now(),
    };
}

module.exports = { buildSnapshot, backendInfo, ggufName, PKG_VERSION };
