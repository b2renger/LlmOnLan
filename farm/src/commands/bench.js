// `lol bench` — load-test the farm before a workshop: fire N concurrent
// STREAMING chat completions per round at the proxy and report what students
// would feel — TTFT (time to first token = perceived wait), total duration,
// and tokens/s — per request and aggregated (p50/p95).
//
//   lol bench [--users N] [--rounds R] [--model id] [--url http://host:4000]
//             [--prompt "..."] [--max-tokens M]
//
// One Ollama serves OLLAMA_NUM_PARALLEL generations at once (default 2) and
// queues the rest — this makes that visible: watch TTFT climb as --users passes
// the parallel limit. Size the fleet by concurrent in-flight generations.

const log = require('../log');
const { loadConfig } = require('../config');

function flag(args, name, dflt) {
    const i = args.indexOf(name);
    if (i >= 0 && args[i + 1] !== undefined) return args[i + 1];
    const eq = args.find((a) => a.startsWith(name + '='));
    if (eq) return eq.slice(name.length + 1);
    return dflt;
}

// One streaming chat completion; returns timing + token counts.
async function oneRequest(url, key, model, prompt, maxTokens) {
    const t0 = Date.now();
    let ttftMs = null;
    let completionTokens = null;
    let chunks = 0;
    const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: maxTokens,
        }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

    // Parse the SSE stream: first content delta = TTFT; the final usage chunk
    // (stream_options.include_usage) carries the real completion token count.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            let obj;
            try { obj = JSON.parse(data); } catch { continue; }
            if (obj.usage && obj.usage.completion_tokens != null) completionTokens = obj.usage.completion_tokens;
            const delta = obj.choices && obj.choices[0] && obj.choices[0].delta;
            if (delta && (delta.content || delta.reasoning_content)) {
                chunks++;
                if (ttftMs === null) ttftMs = Date.now() - t0;
            }
        }
    }
    const totalMs = Date.now() - t0;
    const tokens = completionTokens ?? chunks; // fall back to chunk count
    return { ttftMs: ttftMs ?? totalMs, totalMs, tokens, tps: tokens / Math.max(0.001, (totalMs - (ttftMs ?? 0)) / 1000) };
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const fmtS = (ms) => (ms / 1000).toFixed(1) + 's';

async function run(args = []) {
    let config = null;
    try { ({ config } = loadConfig()); } catch { /* bench can run with --url alone */ }

    const users = parseInt(flag(args, '--users', '4'), 10) || 4;
    const rounds = parseInt(flag(args, '--rounds', '2'), 10) || 2;
    const url = String(flag(args, '--url', `http://127.0.0.1:${config?.proxy.port || 4000}`)).replace(/\/+$/, '');
    const key = config?.proxy.masterKey || null;
    const maxTokens = parseInt(flag(args, '--max-tokens', '200'), 10) || 200;
    const prompt = flag(args, '--prompt', 'Explain in about 150 words why the sky is blue.');

    // Model: --model wins, else the proxy's first served model.
    let model = flag(args, '--model', null);
    if (!model) {
        try {
            const j = await (await fetch(`${url}/v1/models`, { headers: key ? { authorization: `Bearer ${key}` } : {} })).json();
            model = j.data && j.data[0] && j.data[0].id;
        } catch { /* fall through */ }
    }
    if (!model) { log.err(`No model — is the farm up at ${url}? (or pass --model)`); return 1; }

    log.info(`Bench — ${log.paint.bold(`${users} concurrent user(s) × ${rounds} round(s)`)} → ${url} (${model}, ≤${maxTokens} tokens)`);
    const all = [];
    for (let r = 1; r <= rounds; r++) {
        log.step(`Round ${r}/${rounds} — firing ${users} request(s) …`);
        const t0 = Date.now();
        const results = await Promise.all(Array.from({ length: users }, (_, i) =>
            oneRequest(url, key, model, prompt, maxTokens)
                .then((x) => ({ ...x, i, ok: true }))
                .catch((e) => ({ i, ok: false, error: e.message }))));
        const wall = Date.now() - t0;
        for (const x of results) {
            if (x.ok) log.plain(`    #${x.i + 1}  first token ${log.paint.cyan(fmtS(x.ttftMs))}   total ${fmtS(x.totalMs)}   ${x.tokens} tok @ ${x.tps.toFixed(1)} tok/s`);
            else log.plain(`    #${x.i + 1}  ${log.paint.red('FAILED')} — ${x.error}`);
        }
        const okAll = results.filter((x) => x.ok);
        const totTok = okAll.reduce((s, x) => s + x.tokens, 0);
        log.plain(`    round wall ${fmtS(wall)} · aggregate ${log.paint.bold((totTok / (wall / 1000)).toFixed(1))} tok/s across ${okAll.length}/${users} ok`);
        all.push(...okAll);
    }

    if (all.length) {
        const ttfts = all.map((x) => x.ttftMs).sort((a, b) => a - b);
        const tps = all.map((x) => x.tps).sort((a, b) => a - b);
        log.plain('');
        log.ok(`Summary (${all.length} requests): first token p50 ${log.paint.bold(fmtS(pct(ttfts, 50)))} / p95 ${fmtS(pct(ttfts, 95))} · per-user ${pct(tps, 50).toFixed(1)} tok/s median`);
        if (config) log.info(`Reminder: one Ollama runs ${config.ollama.numParallel} generation(s) at once (ollama.numParallel); more users than that queue.`);
    }
    return all.length ? 0 : 1;
}

module.exports = { run };
