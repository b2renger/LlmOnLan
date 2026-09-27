// Which farm the client uses, and what OWUI is launched with for it. PURE: no Electron, no
// settings file, no clock — index.ts feeds it the live values — so the rules are unit-tested
// against the compiled output (shell/test/chat/unit/shell-main.test.mjs).

import { DiscoveredFarm } from './types';

// Reach a farm at the address we actually saw it (beacon source / probed host),
// not its self-reported primary IP, which may be a different interface.
export function farmEndpoint(f: { _host: string; proxyPort: number }): string {
    return `http://${f._host}:${f.proxyPort}/v1`;
}

// Load metric for a farm, from the telemetry the beacon already carries. Lower =
// more free. Slot occupancy beats GPU%: clients/slots is "how many people are ahead
// of you", where a busy GPU is just a healthy box mid-answer. Old farms without
// `capacity` keep the util heuristic, and a farm that reports neither is treated as
// mid-load so a box we CAN measure and see idle beats an unknown one.
export function farmLoad(f: DiscoveredFarm): number {
    const cap = (f as { capacity?: { slots?: number; clients?: number } }).capacity;
    if (cap && typeof cap.slots === 'number' && cap.slots > 0) {
        return Math.min(100, Math.round(((cap.clients || 0) / cap.slots) * 100));
    }
    const util = f.usage?.gpuUtil;
    return typeof util === 'number' ? util : 50;
}

// Pick the least-loaded healthy farm, scattering ties randomly so a fleet of
// clients booting at once doesn't stampede the same box (at cold start they all
// see every box idle, so jitter spreads them). This runs only when we're actually
// CHOOSING a farm — chooseActive keeps a healthy current farm sticky, so load-aware
// selection never repoints OWUI mid-session (that churn would cost more than the
// imbalance it fixes); it kicks in at first connect and on failover.
//
// If a coordinator farm is present it "absorbs" the fleet — we route through it
// (it balances every request across the boxes centrally), so the candidate pool
// is the coordinators. With no coordinator, the pool is all healthy farms and we
// balance client-side. One rule cleanly covers both deployment styles.
export const LOAD_BAND = 15; // farms within 15 util-points of the minimum count as "equally free"
export function pickLeastLoaded(
    farms: DiscoveredFarm[], usable: (f: DiscoveredFarm) => boolean, rng: () => number = Math.random,
): DiscoveredFarm | null {
    const healthy = farms.filter((x) => x.healthy && !x._stale && usable(x));
    if (!healthy.length) return null;
    const coordinators = healthy.filter((x) => x.coordinator);
    const pool = coordinators.length ? coordinators : healthy;
    if (pool.length === 1) return pool[0];
    const min = Math.min(...pool.map(farmLoad));
    const contenders = pool.filter((x) => farmLoad(x) <= min + LOAD_BAND);
    return contenders[Math.floor(rng() * contenders.length)];
}

export interface ChooseInput {
    selectedFarmId: string | null;   // the user's pin (a card click); null = automatic
    activeFarmId: string | null;     // the farm in use right now
    currentEndpoint: string | null;  // the endpoint OWUI was booted with (last session's, on a cold boot)
    usable: (f: DiscoveredFarm) => boolean; // false for a keyed farm we have no password for
    rng?: () => number;
}

// Pick the farm OWUI should use: the user's pinned choice, else the current one
// if still good (sticky — avoids flapping between equivalents), else the
// least-loaded healthy farm (spreads a fleet of clients across the boxes).
export function chooseActive(farms: DiscoveredFarm[], o: ChooseInput): DiscoveredFarm | null {
    const good = (x: DiscoveredFarm) => x.healthy && !x._stale;
    if (o.selectedFarmId) { const f = farms.find((x) => x.id === o.selectedFarmId && good(x)); if (f) return f; }
    if (o.activeFarmId) { const f = farms.find((x) => x.id === o.activeFarmId && good(x)); if (f) return f; }
    // Cold boot on a multi-farm LAN: stay with LAST session's farm while it's
    // healthy. The boot sidecar was already started against its endpoint
    // (lastEndpoint), so re-rolling the load dice here would repoint — a full
    // second OWUI boot — for no gain. Load-aware spreading still applies to
    // first-ever connects and to failover (this farm gone/unhealthy).
    if (o.currentEndpoint) {
        const f = farms.find((x) => good(x) && farmEndpoint(x) === o.currentEndpoint);
        if (f) return f;
    }
    return pickLeastLoaded(farms, o.usable, o.rng);
}

// Everything OWUI is launched with for one farm. `key` is the stored password (null for an
// open farm). Built ONCE per farm choice, compared as a whole and persisted as a whole: the
// pin path used to persist only the endpoint and to leave the password out of the comparison,
// so a pinned keyed farm cold-booted with the previous farm's password and 401-looped behind a
// green pill (docs review SA-4).
export interface FarmContext {
    endpoint: string;       // → OPENAI_API_BASE_URL
    key: string | null;     // → OPENAI_API_KEY (the farm password; null = open farm)
    // The farm's advertised default model (or its first) → DEFAULT_MODELS, so OWUI always
    // auto-selects whatever the farm serves. null if the farm lists none.
    model: string | null;
    searxng: string | null; // the farm's shared SearXNG → OWUI web search; null when it hosts none
    tts: { url: string; voice: string; model: string } | null; // shared Kokoro → AUDIO_TTS_*
    // Shared OCR loader → CONTENT_EXTRACTION_ENGINE=external. Needs both a url and a key
    // (OWUI's loader mandates the key).
    extract: { url: string; key: string } | null;
    // The context window ONE chat gets (llama.cpp splits --ctx-size across slots; Ollama's
    // num_ctx is already per request) → whole-document vs top-k RAG in configBridge. Null on
    // farms older than farm-v0.0.22 — the bridge then keeps the historic whole-document default.
    ctxPerSlot: number | null;
}

export function farmContext(f: DiscoveredFarm, key: string | null): FarmContext {
    const models = f.models;
    const model = Array.isArray(models) && models.length ? ((models.find((m) => m.default) || models[0])?.id || null) : null;
    const ctx = f.backend?.contextPerSlot;
    return {
        endpoint: farmEndpoint(f),
        key: key || null,
        model,
        searxng: f.searxngUrl || null,
        tts: f.ttsUrl ? { url: f.ttsUrl, voice: f.ttsVoice || 'af_heart', model: f.ttsModel || 'kokoro' } : null,
        extract: f.extract?.url && f.extract.key ? { url: f.extract.url, key: f.extract.key } : null,
        ctxPerSlot: typeof ctx === 'number' && ctx > 0 ? ctx : null,
    };
}

// Did anything OWUI is launched with change?
export function sameContext(a: FarmContext | null, b: FarmContext | null): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

// The settings that seed the next cold launch — every field, so the first sidecar boot is
// already right and the first beacon does not force a second OWUI boot.
export function persistedContext(c: FarmContext): {
    lastEndpoint: string; lastFarmKey: string | null; lastFarmModel: string | null; lastFarmSearxng: string | null;
    lastFarmTts: FarmContext['tts']; lastFarmExtract: FarmContext['extract']; lastFarmCtxPerSlot: number | null;
} {
    return {
        lastEndpoint: c.endpoint, lastFarmKey: c.key, lastFarmModel: c.model, lastFarmSearxng: c.searxng,
        lastFarmTts: c.tts, lastFarmExtract: c.extract, lastFarmCtxPerSlot: c.ctxPerSlot,
    };
}
