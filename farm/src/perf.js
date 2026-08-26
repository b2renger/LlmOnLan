// Performance monitoring + VRAM budgeting for the farm.
//
// Born from a live incident (AN-VR-01, 2026-08-26): the panel let an operator set a
// 256k context window on a 12 GB card. llama-server "successfully" started — Windows
// WDDM overcommits CUDA allocations into system RAM — and the box sat at 11.6/12 GB
// VRAM *at idle*, paging every token over PCIe. Nothing measured throughput, nothing
// knew what would fit, so the farm was "back to too slow" with no visible cause.
//
// Three pure pieces live here so they can be unit-tested without a GPU:
//   • parsePrometheus / sampleRates — read llama-server's --metrics endpoint into
//     "how fast is it actually generating".
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
        busy: m['llamacpp:requests_processing'] ?? 0,
        queued: m['llamacpp:requests_deferred'] ?? 0,
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
    const out = { reset: false, genTokSec: null, promptTokSec: null, genTokens: dTok };
    if (dTok > 0 && dSec > 0.05) out.genTokSec = Math.round((dTok / dSec) * 10) / 10;
    const dpTok = (cur.promptTok ?? 0) - (prev.promptTok ?? 0);
    const dpSec = (cur.promptSec ?? 0) - (prev.promptSec ?? 0);
    if (dpTok > 0 && dpSec > 0.05) out.promptTokSec = Math.round(dpTok / dpSec);
    return out;
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
// Returns { needGb, budgetGb, maxContext, fits } — maxContext in 4096 steps, ≥ 4096
// whenever the weights themselves fit (a model too big for ANY context reports
// maxContext 0).
function fitBudget({ vramGb, weightsGb, mmprojGb = 0, kvCacheType = 'q4_0', contextLength = 16384, kvRate = null }) {
    // `kvRate` (GB per 16k) computed from the model's OWN header (gguf.js) beats
    // the table — the table is the shipped model's measurement, wrong for models
    // an operator adds by URL.
    const rate = kvRate || KV_GB_PER_16K[kvCacheType] || KV_GB_PER_16K.f16;
    const kvGb = (contextLength / 16384) * rate;
    const needGb = round1((weightsGb || 0) + (mmprojGb || 0) + OVERHEAD_GB + kvGb);
    if (!vramGb || !weightsGb) return { needGb, budgetGb: null, maxContext: null, fits: null };
    const budgetGb = round1(vramGb - MARGIN_GB - weightsGb - (mmprojGb || 0) - OVERHEAD_GB);
    const rawMax = Math.floor(((budgetGb / rate) * 16384) / 4096) * 4096;
    const maxContext = rawMax >= 4096 ? rawMax : 0;
    return { needGb, budgetGb, maxContext, fits: needGb <= vramGb - MARGIN_GB, kvRate: round1(rate * 100) / 100 };
}

function round1(n) { return Math.round(n * 10) / 10; }

// --- eviction under pressure ---------------------------------------------------

// While llama.cpp is the engine, the only thing that loads Ollama models is the OCR
// plugin — and with keep-alive it can pin a ~7.6 GB vision model next to a resident
// llama-server on a card that holds one of them. Evict when: llama.cpp serves, VRAM
// is nearly full, something IS loaded on Ollama, and the GPU is idle (never yank a
// model out from under a running extraction or generation — util is high then).
function shouldEvictOllama({ llamacppOn, vramUsedGb, vramTotalGb, gpuUtil, loadedCount }) {
    if (!llamacppOn || !loadedCount) return false;
    if (!vramTotalGb || vramUsedGb == null) return false;
    if (vramUsedGb / vramTotalGb < 0.92) return false;
    if (gpuUtil != null && gpuUtil > 20) return false;
    return true;
}

module.exports = {
    parsePrometheus, metricsSample, sampleRates,
    fitBudget, KV_GB_PER_16K, OVERHEAD_GB, MARGIN_GB,
    shouldEvictOllama,
};
