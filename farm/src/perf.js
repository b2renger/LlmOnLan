// Performance monitoring + VRAM budgeting for the farm.
//
// Born from a live incident (AN-VR-01, 2026-08-26): the panel let an operator set a
// 256k context window on a 12 GB card. llama-server "successfully" started — Windows
// WDDM overcommits CUDA allocations into system RAM — and the box sat at 11.6/12 GB
// VRAM *at idle*, paging every token over PCIe. Nothing measured throughput, nothing
// knew what would fit, so the farm was "back to too slow" with no visible cause.
//
// Three pure pieces live here so they can be unit-tested without a GPU:
//   • parsePrometheus / sampleRates — read llama-server's --metrics endpoint (or an
//     external vLLM's, through vllmSample) into "how fast is it actually generating".
//   • fitBudget — estimate whether weights + KV cache fit VRAM, and the largest
//     context window that does. An ESTIMATE (the KV rate is measured, not derived),
//     used to warn and clamp, deliberately with margin.
//   • shouldEvictOllama — while llama.cpp is the engine, an Ollama model left in
//     VRAM (document OCR with keep_alive) starves it; decide when to free it.

// --- llama-server /metrics -----------------------------------------------------

// Prometheus text format → { name: value }. llama.cpp's metrics are unlabeled
// gauges/counters (llamacpp:tokens_predicted_total 123), which is all we need.
function parsePrometheus(text) {
    const out = {};
    for (const line of String(text || '').split('\n')) {
        if (!line || line[0] === '#') continue;
        const sp = line.lastIndexOf(' ');
        if (sp <= 0) continue;
        const name = line.slice(0, sp).trim();
        const val = Number(line.slice(sp + 1));
        if (name && Number.isFinite(val)) out[name] = val;
    }
    return out;
}

// One sample of the counters we rate-derive from.
function metricsSample(m, ts) {
    return {
        ts,
        predTok: m['llamacpp:tokens_predicted_total'] ?? null,
        predSec: m['llamacpp:tokens_predicted_seconds_total'] ?? null,
        promptTok: m['llamacpp:prompt_tokens_total'] ?? null,
        promptSec: m['llamacpp:prompt_seconds_total'] ?? null,
        // Prompt tokens served FROM the KV cache instead of being re-processed —
        // b10670's own counter, and the direct proof of whether cache-reuse /
        // cache-ram / slot routing are earning their keep. Verified live: a
        // repeated 3182-token prompt showed processed=518, cached=2666.
        cachedTok: m['llamacpp:prompt_tokens_cached_total'] ?? null,
        busy: m['llamacpp:requests_processing'] ?? 0,
        queued: m['llamacpp:requests_deferred'] ?? 0,
        // Gone in b10670 (metric was dropped upstream); kept for older builds an
        // operator points binDir at. Consumers must treat null as "unknown".
        kvUsed: m['llamacpp:kv_cache_usage_ratio'] ?? null,
    };
}

// Rates between two samples. The naive delta(tokens)/delta(wallclock) understates
// badly — it averages in idle time — so we divide by delta of the engine's OWN
// "seconds spent generating" counter: true tok/s *while generating*. Returns null
// when there was no generation in the window, or when the counters went BACKWARDS
// (llama-server restarted on a model swap — the baseline is stale, skip the sample).
function sampleRates(prev, cur) {
    if (!prev || !cur) return null;
    if (cur.predTok == null || prev.predTok == null) return null;
    const dTok = cur.predTok - prev.predTok;
    const dSec = (cur.predSec ?? 0) - (prev.predSec ?? 0);
    if (dTok < 0 || dSec < 0) return { reset: true };          // counter reset (restart)
    const out = { reset: false, genTokSec: null, promptTokSec: null, genTokens: dTok, cacheHitRatio: null };
    if (dTok > 0 && dSec > 0.05) out.genTokSec = Math.round((dTok / dSec) * 10) / 10;
    const dpTok = (cur.promptTok ?? 0) - (prev.promptTok ?? 0);
    const dpSec = (cur.promptSec ?? 0) - (prev.promptSec ?? 0);
    if (dpTok > 0 && dpSec > 0.05) out.promptTokSec = Math.round(dpTok / dpSec);
    // Cache effectiveness over the window: of every prompt token that arrived,
    // how many were answered from the KV cache instead of re-processed. 1.0 =
    // follow-up turns cost only their new tail; ~0 with long chats = every turn
    // re-reads the whole history (what the cache work exists to prevent).
    const dcTok = (cur.cachedTok ?? 0) - (prev.cachedTok ?? 0);
    if (cur.cachedTok != null && dcTok >= 0 && dpTok >= 0 && dcTok + dpTok > 0) {
        out.cacheHitRatio = Math.round((dcTok / (dcTok + dpTok)) * 100) / 100;
    }
    // A vLLM serves many people at once, so two numbers only its sample carries:
    // everyone's tokens over the window's wall clock, and the share of speculative
    // draft tokens the model accepted (null without a drafter).
    if (cur.vllm) {
        const wallSec = (cur.ts - prev.ts) / 1000;
        out.throughputTokSec = dTok > 0 && wallSec > 0 ? Math.round(dTok / wallSec) : null;
        const dDraft = (cur.drafted ?? 0) - (prev.drafted ?? 0);
        const dAcc = (cur.accepted ?? 0) - (prev.accepted ?? 0);
        out.draftAcceptRatio = cur.drafted != null && dDraft > 0 && dAcc >= 0 ? Math.round((dAcc / dDraft) * 100) / 100 : null;
    }
    return out;
}

// --- an external vLLM's /metrics -----------------------------------------------
// Names read from vLLM's own source (v1/metrics/loggers.py, v1/spec_decode/metrics.py,
// config/cache.py — 0.14.0 as installed, and the v0.8.5 / v0.9.2 / v0.10.2 / main
// tags). Every series carries {model_name, engine} labels, one per data-parallel
// engine, and parsePrometheus keeps a labelled series' whole `name{labels}` as its
// key — so a metric is every key that starts with its name. Older names are the
// fallbacks: gpu_cache_usage_perc and gpu_prefix_cache_* became kv_cache_usage_perc
// and prefix_cache_* in 0.9, time_per_output_token_seconds became
// inter_token_latency_seconds in 0.11 (removed since).
const vKeys = (m, name) => Object.keys(m).filter((k) => k === name || k.startsWith(`${name}{`));
function vRead(m, names, combine) {
    for (const n of names) {
        const ks = vKeys(m, n);
        if (ks.length) return ks.map((k) => m[k]).reduce(combine);
    }
    return null;
}
const vSum = (m, ...names) => vRead(m, names, (a, b) => a + b);

// The KV pool in tokens, from vllm:cache_config_info — an info gauge whose numbers
// are its labels. kv_cache_size_tokens (vLLM >= 0.25) is vLLM's own group-aware
// "GPU KV cache size"; older builds only say num_gpu_blocks x block_size, exact for
// one KV group and an UPPER bound for hybrid models (vLLM shares the blocks among
// its KV groups) — so a shortfall read off it never warns falsely. Summed over
// data-parallel engines; null when any engine does not say.
function vllmPoolTokens(m) {
    let total = 0;
    for (const k of vKeys(m, 'vllm:cache_config_info')) {
        const lab = (n) => Number((new RegExp(`[{,]${n}="([^"]*)"`).exec(k) || [])[1]);
        const t = lab('kv_cache_size_tokens') || lab('num_gpu_blocks') * lab('block_size');
        if (!(t > 0)) return null;
        total += t;
    }
    return total || null;
}

// One vLLM sample in metricsSample's shape, so sampleRates and the panel need no
// second path; null when the map is not a vLLM's (no vllm: series at all).
//   • predTok/predSec — generated tokens over the inter-token-latency sum, the
//     seconds streams spent decoding: TRUE tok/s per person while generating, like
//     llama.cpp's. One latency per decode STEP, so speculative decoding stays right;
//     each request's first token is the prefill's (outside the sum) — a fraction of
//     a percent high on a real reply.
//   • promptTok/cachedTok — prefix-cache misses and hits, so cacheHitRatio is
//     hits / queries. No prefill-seconds counter, so no reading speed.
function vllmSample(m, ts) {
    if (!m || !Object.keys(m).some((k) => k.startsWith('vllm:'))) return null;
    const queried = vSum(m, 'vllm:prefix_cache_queries_total', 'vllm:gpu_prefix_cache_queries_total');
    const cached = vSum(m, 'vllm:prefix_cache_hits_total', 'vllm:gpu_prefix_cache_hits_total');
    return {
        ts,
        vllm: true,
        predTok: vSum(m, 'vllm:generation_tokens_total'),
        predSec: vSum(m, 'vllm:inter_token_latency_seconds_sum', 'vllm:time_per_output_token_seconds_sum'),
        promptTok: queried != null && cached != null ? queried - cached : null,
        promptSec: null,
        cachedTok: cached,
        busy: vSum(m, 'vllm:num_requests_running') ?? 0,
        queued: vSum(m, 'vllm:num_requests_waiting') ?? 0,
        // 0..1 ("1 means 100 percent"); the fullest engine is the one that preempts.
        kvUsed: vRead(m, ['vllm:kv_cache_usage_perc', 'vllm:gpu_cache_usage_perc'], (a, b) => Math.max(a, b)),
        drafted: vSum(m, 'vllm:spec_decode_num_draft_tokens_total'),
        accepted: vSum(m, 'vllm:spec_decode_num_accepted_tokens_total'),
        poolTokens: vllmPoolTokens(m),
    };
}

// vLLM serves /metrics at its root, beside /v1.
function metricsUrlFor(baseUrl) {
    return `${String(baseUrl).replace(/\/+$/, '').replace(/\/v1$/, '')}/metrics`;
}

// The declared seats x window against the pool the server really allocated. Over it,
// the seats cannot all hold their full window at once — vLLM queues or preempts the
// overflow. A warning only: the seats stay external.parallel (owner, 2026-09-07a —
// refusing people on a pessimistic guess is worse than the queueing it would avoid).
function poolShortfall(slots, contextLength, poolTokens) {
    if (!(slots > 0) || !(contextLength > 0) || !(poolTokens > 0) || slots * contextLength <= poolTokens) return null;
    const n = (x) => x.toLocaleString('en-US');
    const fit = Math.floor(poolTokens / contextLength);
    return `The declared ${slots} seat${slots > 1 ? 's' : ''} × ${n(contextLength)} tokens of context need ${n(slots * contextLength)} tokens of context memory, `
        + `but the server holds ${n(poolTokens)} — the declared seats can't all hold their full window at once `
        + `(${fit === 0 ? 'not even one can' : `${fit} can`}). Lower external.parallel or external.contextLength, or give the server more KV cache.`;
}

// --- VRAM budgeting ------------------------------------------------------------

// GB of KV cache per 16384 tokens of TOTAL context, by cache type. Measured on the
// fleet's Qwen3.8-27B ggufs (q4_0 ≈ 1.2 GB/16k — the number the README's capacity
// table is built on); q8_0/f16 scale by the cache element size. Other model families
// will differ — this is a warning threshold, not an allocator.
const KV_GB_PER_16K = { q4_0: 1.2, q8_0: 2.4, f16: 4.8 };
const OVERHEAD_GB = 1.0;   // llama.cpp compute buffers + CUDA context
const MARGIN_GB = 0.4;     // desktop / driver headroom — the difference between
                           // "fits on paper" and "fits with a browser open"

// Estimate the VRAM a llama.cpp shape needs, and the largest context that fits.
// `vramGb` 0/unknown → no verdict (unified-memory boxes report RAM-sized pools and
// integrated GPUs report nothing; refusing there would be wrong).
// `freeGb` = what was free for this engine when it was sized (null = unknown → the
// whole card), and `reserveGb` = what the operator keeps back for other apps: a GPU
// shared with another app (ComfyUI kept ~45 GB of the PRO 6000 resident) must not be
// budgeted as if it were empty (multi-user plan 0.7).
// Returns { needGb, budgetGb, maxContext, fits, usableGb } — maxContext in 4096 steps,
// ≥ 4096 whenever the weights themselves fit (a model too big for ANY context reports
// maxContext 0); usableGb is the VRAM it budgeted against.
function fitBudget({ vramGb, freeGb = null, reserveGb = 0, weightsGb, mmprojGb = 0, kvCacheType = 'q4_0', contextLength = 16384, kvRate = null }) {
    // `kvRate` (GB per 16k) computed from the model's OWN header (gguf.js) beats
    // the table — the table is the shipped model's measurement, wrong for models
    // an operator adds by URL.
    const rate = kvRate || KV_GB_PER_16K[kvCacheType] || KV_GB_PER_16K.f16;
    const kvGb = (contextLength / 16384) * rate;
    const needGb = round1((weightsGb || 0) + (mmprojGb || 0) + OVERHEAD_GB + kvGb);
    if (!vramGb || !weightsGb) return { needGb, budgetGb: null, maxContext: null, fits: null };
    const usableGb = round1(Math.min(vramGb, freeGb ?? vramGb) - (reserveGb || 0));
    const budgetGb = round1(usableGb - MARGIN_GB - weightsGb - (mmprojGb || 0) - OVERHEAD_GB);
    const rawMax = Math.floor(((budgetGb / rate) * 16384) / 4096) * 4096;
    const maxContext = rawMax >= 4096 ? rawMax : 0;
    return { needGb, budgetGb, maxContext, fits: needGb <= usableGb - MARGIN_GB, kvRate: round1(rate * 100) / 100, usableGb };
}

function round1(n) { return Math.round(n * 10) / 10; }

// --- eviction under pressure ---------------------------------------------------

// While another engine serves chat (llama.cpp, or an external server on this box),
// the only thing that loads Ollama models is the OCR plugin — and with keep-alive it
// can pin a ~7.6 GB vision model next to the resident engine on a card that holds
// one of them. Evict when: a non-Ollama engine serves, VRAM is nearly full,
// something IS loaded on Ollama, and the GPU is idle (never yank a model out from
// under a running extraction or generation — util is high then).
// `otherEngineOn` (= !ollamaServes); `llamacppOn` is its older name, still accepted.
function shouldEvictOllama({ otherEngineOn, llamacppOn, vramUsedGb, vramTotalGb, gpuUtil, loadedCount }) {
    const other = otherEngineOn ?? llamacppOn;
    if (!other || !loadedCount) return false;
    if (!vramTotalGb || vramUsedGb == null) return false;
    if (vramUsedGb / vramTotalGb < 0.92) return false;
    if (gpuUtil != null && gpuUtil > 20) return false;
    return true;
}

// --- a GPU stuck at a low clock ---------------------------------------------------
// On a DGX Spark a unified-memory OOM latched the GB10 at ~700 MHz under full load (no
// throttle reason, a third of its speed) until the box was fully powered off; a warm reboot
// did not clear it (docs/spike/RESULTS.md, "PRO 6000 vs Spark" 6). Nothing else tells the
// operator: the farm just answers slowly. Owner decision 2026-10-07: the panel says so.
// Fed each health tick's gpuLiveStats(). An idle GPU clocks down on purpose, so only BUSY
// samples (≥ 80 % utilisation) count: STUCK_SAMPLES of them in a row under STUCK_MHZ (and under
// half the max SM clock when the GPU reports one) raise it, one busy sample at a normal clock
// clears it, and idle samples change nothing (the latch outlives the load). The fixed floor
// matters twice: a GB10 may not report clocks.max.sm (the latched Spark read its power limits
// as N/A), and a power-capped card (a 300 W Max-Q mid-prefill) can dip under half its max
// while healthy, but not to a third of it. Returns the low clock to report, or null.
const STUCK_SAMPLES = 3;
const STUCK_MHZ = 1000;
function makeClockWatch() {
    let low = 0;
    let mhz = null;
    return (g) => {
        if (g && g.gpuUtil != null && g.gpuUtil >= 80 && g.smMhz != null) {
            const stuck = g.smMhz < STUCK_MHZ && !(g.smMaxMhz > 0 && g.smMhz >= g.smMaxMhz / 2);
            if (stuck) { low += 1; mhz = g.smMhz; } else { low = 0; mhz = null; }
        }
        return low >= STUCK_SAMPLES ? mhz : null;
    };
}

module.exports = {
    parsePrometheus, metricsSample, sampleRates,
    vllmSample, metricsUrlFor, poolShortfall,
    fitBudget, KV_GB_PER_16K, OVERHEAD_GB, MARGIN_GB,
    shouldEvictOllama, makeClockWatch,
};
