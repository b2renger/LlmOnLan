// Mutable mock-farm state + the request log (plan §2.3).
//
// `store.state` is a LIVE object: `POST /mock/state` deep-merges into it and
// `POST /mock/reset` empties it and refills it with the defaults IN PLACE, so a
// caller that kept the reference from `startMock()` keeps seeing the truth.
'use strict';

/** The snapshot/behaviour defaults. Everything here is settable via POST /mock/state. */
function defaults() {
    return {
        // ---- /lol/self snapshot ----------------------------------------------------
        name: 'Mock Farm',
        id: 'mockfarm0001',
        version: '0.0.20-mock',
        requiresKey: false,          // the OPEN listener; the keyed one always requires a key
        coordinator: false,
        healthy: true,
        models: [
            { id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true },
            { id: 'gemma4:12b', underlying: 'gemma4:12b', default: false },
        ],
        backend: {
            engine: 'llama.cpp', alias: 'assistant', model: 'Qwen3.8-27B-UD-Q2_K_XL',
            contextLength: 32768, contextPerSlot: 16384, slots: 2,
            mtp: false, kvCacheType: 'q4_0',
        },
        // Seat-gate shape (farm-v0.0.36+): seatsUsed is the ENFORCED count, clients is merely who
        // has the app open. They differ ON PURPOSE (1 seat of 2 used, 3 apps connected) so the
        // client renders "1 of 2 seats free · 3 connected" instead of the legacy single-number
        // path. shell/test/e2e.js is frozen and asserts BOTH halves of that string, so a scenario
        // that wants them equal must say so with POST /mock/state, never by editing this default.
        capacity: { slots: 2, clients: 3, seatsUsed: 1, seatIdleSec: 900 },
        busy: null,                  // { label, message, percent } exercises the switching UI
        perf: { lastGenTokSec: 48 },
        usage: { gpuUtil: 3, vramUsedGb: 10.6, vramTotalGb: 12, loaded: [], clients: 0 },
        host: { gpu: 'Mock RTX', vramGb: 12, ramGb: 64, cpuCores: 16 },
        health: { proxyUp: true, hostsUp: 1, hostsTotal: 1, loaded: [] },
        deployments: 1,
        // Plugin endpoints stay null until the P3/P4 kickoffs add the services.
        searxngUrl: null, ttsUrl: null, ttsVoice: null, ttsModel: null, extract: null,
        plugins: {}, recommendedClientPlugins: [],

        // ---- behaviour switches ----------------------------------------------------
        proxyDown: false,            // both proxy listeners destroy incoming sockets
        visionRefuseAll: false,      // P3: every model refuses image parts
        searchDown: false,           // P3: /searxng/search → 500
        ttsMp3Broken: false,         // P4: mp3 responses are garbage bytes
        mcpoShape: 'dataurl',        // P3: dataurl | base64 | object | array | text-error
        streamRate: null,            // { tickMs, perTick } overrides the ~330 deltas/s pacing
        fixtureSeed: 12345,          // seeds the mock-md / mock-xss chunking
        // S0 (studio plan 2.3): the ask spine's switches.
        structuredDrop: false,       // the proxy strips response_format before dispatch
        askDelayMs: 0,               // a lead-in delay before the first delta of a paced stream
        modelGroupInfo: null,        // REPLACES the body of GET /model_group/info outright
        // K3 kickoff: what `mock-verdict` answers, consumed in order, last entry repeating.
        verdicts: ['maybe'],
    };
}

const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merge `patch` into `target` in place (arrays and nulls replace). */
function deepMerge(target, patch) {
    if (!isPlain(patch)) return target;
    for (const [k, v] of Object.entries(patch)) {
        if (isPlain(v) && isPlain(target[k])) deepMerge(target[k], v);
        else target[k] = isPlain(v) ? deepMerge({}, v) : v;
    }
    return target;
}

function createStore() {
    /** @type {Record<string, any>} */
    const state = deepMerge({}, defaults());
    /** @type {Array<Record<string, any>>} */
    const log = [];
    const store = {
        state,
        log,
        lastBody: null,          // the raw text of the last POST /v1/chat/completions
        verdictAt: 0,            // K3: how far through `state.verdicts` mock-verdict has got
        beacon: false,           // reported by GET /mock/health
        warnings: [],            // e.g. a missing fixture file
        maxLog: 500,

        /** Append a log entry; the entry object is returned so the caller can mutate it. */
        push(entry) {
            const e = Object.assign({ ts: Date.now(), closedEarly: false }, entry);
            log.push(e);
            while (log.length > store.maxLog) log.shift();
            return e;
        },
        warn(msg) {
            if (!store.warnings.includes(msg)) {
                store.warnings.push(msg);
                console.warn(`[mock] ${msg}`);
            }
        },
        merge(patch) { return deepMerge(state, patch); },
        reset() {
            for (const k of Object.keys(state)) delete state[k];
            deepMerge(state, defaults());
            log.length = 0;
            store.lastBody = null;
            store.verdictAt = 0;
            store.warnings.length = 0;
            return state;
        },
        /** Seats are full → every completion POST is refused (plan §2.3). */
        seatsFull() {
            const c = state.capacity || {};
            return Number(c.seatsUsed) >= Number(c.slots);
        },
    };
    return store;
}

module.exports = { createStore, defaults, deepMerge };
