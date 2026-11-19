// Does a presence penalty stop vLLM reusing a prompt's cached prefix? (night n° 10, 2026-11-19.) The same ~10k-token
// prompt sent twice without a penalty, then twice with the farm's Qwen3.6 one (presence_penalty 1.5), each pair on a
// prompt of its own; vLLM's own counters (/metrics: prefix_cache_queries_total, prefix_cache_hits_total) read around
// each request, and the first-token time of each.
//   node prefix_penalty.mjs <vLLM root URL, no /v1> <model> [extra request fields as JSON for the penalty arm]
const [, , url, model, extraArg] = process.argv;
if (!model) { console.log('usage: node prefix_penalty.mjs <url> <model> [extra JSON]'); process.exit(2); }
const base = url.replace(/\/+$/, '');
const penalty = extraArg ? JSON.parse(extraArg) : { presence_penalty: 1.5 };
// METRICS_URL: read vLLM's counters there when the requests go through a farm's gate (its /metrics is not routed).
const metricsBase = (process.env.METRICS_URL || base).replace(/\/+$/, '');
const metric = async () => {
    const t = await (await fetch(`${metricsBase}/metrics`)).text();
    const sum = (name) => t.split('\n').filter((l) => l.startsWith(name + '{') || l.startsWith(name + ' ')).reduce((a, l) => a + Number(l.trim().split(/\s+/).pop()), 0);
    return { q: sum('vllm:prefix_cache_queries_total'), h: sum('vllm:prefix_cache_hits_total') };
};
const words = (seed) => Array.from({ length: 7000 }, (_, i) => `w${(i * 7919 + seed * 104729) % 50000}`).join(' ');
const ask = async (text, extra) => {
    const t0 = performance.now();
    const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 8, stream: true, chat_template_kwargs: { enable_thinking: false }, messages: [{ role: 'user', content: `${text}\n\nHow many words above start with w1? Guess.` }], ...extra }) });
    let first = 0;
    for await (const _ of res.body) { if (!first) first = performance.now(); }
    return (first - t0) / 1000;
};
for (const [label, extra, seed] of [['no penalty', {}, 1], ['presence_penalty 1.5', penalty, 2]]) {
    const text = words(seed);
    for (const turn of [1, 2]) {
        const a = await metric();
        const ttft = await ask(text, extra);
        const b = await metric();
        console.log(`[prefix] ${label}, turn ${turn}: first token ${ttft.toFixed(2)} s; cache queried ${b.q - a.q} tokens, hit ${b.h - a.h}`);
    }
}
