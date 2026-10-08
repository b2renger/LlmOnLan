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
    // The farm's document search → Open WebUI's embedding engine (configBridge decides whether this client uses it:
    // only a contract it knows). Needs a url, a key and a contract.
    embed: { url: string; key: string; contract: string } | null;
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
        embed: f.embed?.url && f.embed.key && f.embed.contract ? { url: f.embed.url, key: f.embed.key, contract: f.embed.contract } : null,
        ctxPerSlot: typeof ctx === 'number' && ctx > 0 ? ctx : null,
    };
}

// Did anything OWUI is launched with change?
export function sameContext(a: FarmContext | null, b: FarmContext | null): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

// The settings that seed the next cold launch — every field, so the first sidecar boot is
// already right and the first beacon does not force a second OWUI boot.
export interface SavedContext {
    lastEndpoint: string; lastFarmKey: string | null; lastFarmModel: string | null; lastFarmSearxng: string | null;
    lastFarmTts: FarmContext['tts']; lastFarmExtract: FarmContext['extract']; lastFarmEmbed: FarmContext['embed']; lastFarmCtxPerSlot: number | null;
}
export function persistedContext(c: FarmContext): SavedContext {
    return {
        lastEndpoint: c.endpoint, lastFarmKey: c.key, lastFarmModel: c.model, lastFarmSearxng: c.searxng,
        lastFarmTts: c.tts, lastFarmExtract: c.extract, lastFarmEmbed: c.embed, lastFarmCtxPerSlot: c.ctxPerSlot,
    };
}

// Connecting to a farm with context `next`: `repoint` when OWUI runs anything else (it restarts), and
// `save` (the settings patch) whenever the settings do not hold `next` yet. The two are independent. A boot
// that found the farm already runs `next`, and saving only on a repoint left that client without a
// lastEndpoint for good: every launch waited up to 4.5 s for discovery before starting OWUI, and a launch
// with the farm not seen yet booted OWUI without it, then again when the farm came (chat at 32 s instead of
// 12 s, measured 2026-10-07). `saved` is the settings; unchanged settings are not rewritten on every beacon.
export function connectPlan(next: FarmContext, running: FarmContext | null, saved: Partial<Record<keyof SavedContext, unknown>>): { repoint: boolean; save: SavedContext | null } {
    const p = persistedContext(next);
    const held = (Object.keys(p) as (keyof SavedContext)[]).every((k) => JSON.stringify(p[k]) === JSON.stringify(saved[k] ?? null));
    return { repoint: !sameContext(next, running), save: held ? null : p };
}

// Plugin keys are tied to the farm password (owner, 2026-09-27): a farm with a password leaves its
// plugins' keys out of the beacon, and a client holding the password fetches them from the farm's
// /lol/plugin-keys (index.ts). These are the pure rules; `hit` is the cached answer for this farm.
export const PLUGIN_KEYS = ['extract', 'classify', 'stt', 'embed'] as const;
export interface PluginKeyEntry { sig: string; keys: Record<string, string | null>; retryAt: number }

/** The farm with its plugin keys filled in from `hit`, and `fetchSig` when they must be fetched
 * (first time, the password or a plugin URL changed, or a failed fetch is due for a retry). */
export function applyPluginKeys<T extends { requiresKey?: boolean }>(f: T, key: string | null, hit: PluginKeyEntry | undefined, now: number): { farm: T; fetchSig: string | null } {
    const plugins = f as unknown as Record<string, { url?: string; key?: string | null; keyId?: string } | null | undefined>;
    if (!f.requiresKey || !key) return { farm: f, fetchSig: null };
    const need = PLUGIN_KEYS.filter((k) => plugins[k] && plugins[k]!.url && !plugins[k]!.key);
    if (!need.length) return { farm: f, fetchSig: null };
    const sig = JSON.stringify([key, ...PLUGIN_KEYS.map((k) => [plugins[k]?.url || null, plugins[k]?.keyId || null])]);
    const fresh = !!hit && hit.sig === sig;
    const due = !fresh || (!Object.keys(hit!.keys).length && now >= hit!.retryAt);
    if (!fresh) return { farm: f, fetchSig: sig };
    const out = { ...f } as unknown as Record<string, unknown>;
    for (const k of need) if (hit!.keys[k]) out[k] = { ...plugins[k], key: hit!.keys[k] };
    return { farm: out as unknown as T, fetchSig: due ? sig : null };
}

/** While a keyed farm's plugin keys are still being fetched, keep the OCR loader and the document search Open WebUI
 * already has for the SAME address: a pending fetch must not change the launch env, or a cold launch boots
 * Open WebUI three times (release critic R2). `known` = what Open WebUI runs with (or the saved context). */
export function keepPending<T extends { requiresKey?: boolean; extract?: { url?: string } | null; embed?: { url?: string } | null }>(next: FarmContext, farm: T, known: Pick<FarmContext, 'extract' | 'embed'>): FarmContext {
    if (!farm.requiresKey) return next;
    const out = { ...next };
    for (const k of ['extract', 'embed'] as const) {
        const had = known[k];
        if (!out[k] && farm[k] && farm[k]!.url && had && had.url === farm[k]!.url) (out as Record<string, unknown>)[k] = had;
    }
    return out;
}
