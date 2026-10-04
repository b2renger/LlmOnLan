// `lol bench` — load-test the farm before a workshop: fire N concurrent STREAMING
// chat completions per round at the proxy and report what students would feel —
// TTFT (time to first token = perceived wait), total duration, tokens/s — per
// request and aggregated (p50/p95), and how many the seat gate turned away.
//
//   lol bench [--users N] [--rounds R] [--model id] [--url http://host:4000]
//             [--prompt "..."] [--max-tokens M] [--people] [--cancel F] [--out file.json]
//
// By default every user comes from this machine's one address — ONE seat on the
// gate — so this measures the ENGINE: one Ollama serves OLLAMA_NUM_PARALLEL
// generations at once and queues the rest; watch TTFT climb as --users passes
// the parallel limit.
// --people simulates PEOPLE (multi-user plan 0.5): against a loopback URL each user
// connects from its own 127.0.0.<n> (Windows and Linux route all of 127/8; macOS
// only has 127.0.0.1 unless aliased), so the gate seats each one and users past
// the seats get its 429, as at a workshop. Opt-in because those seats stay held
// for proxy.seatIdleSec (15 min) after the run: on a farm people are using, that
// locks them out. A LAN URL always comes from this machine's one address.
// --cancel F aborts that share of each round's streams half-way (a person pressing
// Stop); --out saves every request and the summary as JSON.

const fs = require('fs');
const net = require('net');
const path = require('path');
const log = require('../log');
const { loadConfig } = require('../config');

function flag(args, name, dflt) {
    const i = args.indexOf(name);
    if (i >= 0 && args[i + 1] !== undefined) return args[i + 1];
    const eq = args.find((a) => a.startsWith(name + '='));
    if (eq) return eq.slice(name.length + 1);
    return dflt;
}

// Simulated person i's own loopback address: 127.0.0.2, .3, … (127.0.0.1 is left to
// the real client on this box, so the bench never shares its seat).
function sourceFor(i) {
    const n = i + 2;
    return `127.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

// Can this OS connect from 127.0.0.2? (macOS: not without `ifconfig lo0 alias`.)
function canBind(addr) {
    return new Promise((resolve) => {
        const s = net.createServer();
        s.once('error', () => resolve(false));
        s.listen(0, addr, () => s.close(() => resolve(true)));
    });
}

// One streaming chat completion; returns timing + token counts. `cancelAfter` content
// chunks → the stream is aborted there (a person pressing Stop). Never rejects: a 429
// or a dead socket is a RESULT here, counted in the summary.
function oneRequest(url, key, model, prompt, maxTokens, { localAddress = null, cancelAfter = null } = {}) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        let ttftMs = null;
        let completionTokens = null;
        let chunks = 0;
        let settled = false;
        const finish = (x) => { if (!settled) { settled = true; resolve(x); } };
        const timing = (extra) => {
            const totalMs = Date.now() - t0;
            const tokens = completionTokens ?? chunks; // fall back to chunk count
            return { ok: true, status: 200, ttftMs: ttftMs ?? totalMs, totalMs, tokens, tps: tokens / Math.max(0.001, (totalMs - (ttftMs ?? 0)) / 1000), ...extra };
        };
        const u = new URL(`${url}/v1/chat/completions`);
        const req = require(u.protocol === 'https:' ? 'https' : 'http').request(u, {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
            ...(localAddress ? { localAddress } : {}),
        }, (res) => {
            if (res.statusCode !== 200) {
                let b = '';
                res.on('data', (c) => { b += c; });
                res.on('end', () => {
                    let m = b;
                    try { m = JSON.parse(b).error.message || b; } catch { /* not the OpenAI error shape */ }
                    finish({ ok: false, status: res.statusCode, error: `HTTP ${res.statusCode}: ${String(m).slice(0, 200)}` });
                });
                return;
            }
            // Parse the SSE stream: first content delta = TTFT; the final usage chunk
            // (stream_options.include_usage) carries the real completion token count.
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', (d) => {
                buf += d;
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
                        if (cancelAfter && chunks >= cancelAfter) { finish(timing({ cancelled: true })); req.destroy(); return; }
                    }
                }
            });
            res.on('end', () => finish(timing({ cancelled: false })));
            res.on('error', () => { /* our own abort, or a dead farm: 'close' below says so */ });
            res.on('close', () => finish({ ok: false, status: 200, error: 'the stream broke off before its end' }));
        });
        req.on('error', (e) => finish({ ok: false, status: null, error: e.message }));
        req.end(JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: true,
            stream_options: { include_usage: true },
            max_tokens: maxTokens,
        }));
    });
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
    const cancel = Math.min(1, Math.max(0, Number(flag(args, '--cancel', '0')) || 0));
    const out = flag(args, '--out', null);

    // Model: --model wins, else the proxy's first served model.
    let model = flag(args, '--model', null);
    if (!model) {
        try {
            const j = await (await fetch(`${url}/v1/models`, { headers: key ? { authorization: `Bearer ${key}` } : {} })).json();
            model = j.data && j.data[0] && j.data[0].id;
        } catch { /* fall through */ }
    }
    if (!model) { log.err(`No model — is the farm up at ${url}? (or pass --model)`); return 1; }

    const host = new URL(url).hostname;
    let perUser = false;
    if (args.includes('--people')) {
        if (!(/^127\./.test(host) || host === 'localhost')) log.warn('--people needs a loopback --url (run bench on the farm box): from here every user shares this machine\'s address, one seat.');
        else if (!(await canBind(sourceFor(0)))) log.warn(`This OS cannot send from ${sourceFor(0)} (macOS: sudo ifconfig lo0 alias ${sourceFor(0)}) — every user comes from one address, one seat.`);
        else {
            perUser = true;
            log.warn(`Each simulated person takes a seat on that farm and holds it ~${Math.round((config?.proxy.seatIdleSec || 900) / 60)} min after the run — not on a farm people are using.`);
        }
    }
    // localhost may resolve to ::1, which a 127.x source cannot reach.
    const target = perUser && host === 'localhost' ? url.replace('//localhost', '//127.0.0.1') : url;
    const nCancel = Math.round(cancel * users);
    const cancelAfter = Math.max(1, Math.floor(maxTokens / 2));

    log.info(`Bench — ${log.paint.bold(`${users} ${perUser ? 'people' : 'concurrent stream(s) from one address'} × ${rounds} round(s)`)} → ${url} (${model}, ≤${maxTokens} tokens${nCancel ? `, ${nCancel} stopped half-way` : ''})`);
    const requests = [];
    for (let r = 1; r <= rounds; r++) {
        log.step(`Round ${r}/${rounds} — firing ${users} request(s) …`);
        const t0 = Date.now();
        const results = await Promise.all(Array.from({ length: users }, (_, i) => {
            const source = perUser ? sourceFor(i) : null;
            return oneRequest(target, key, model, prompt, maxTokens, { localAddress: source, cancelAfter: i < nCancel ? cancelAfter : null })
                .then((x) => ({ round: r, user: i + 1, source, ...x }));
        }));
        const wall = Date.now() - t0;
        for (const x of results) {
            if (x.ok) log.plain(`    #${x.user}  first token ${log.paint.cyan(fmtS(x.ttftMs))}   total ${fmtS(x.totalMs)}   ${x.tokens} tok @ ${x.tps.toFixed(1)} tok/s${x.cancelled ? '   (stopped)' : ''}`);
            else log.plain(`    #${x.user}  ${x.status === 429 ? log.paint.yellow('NO SEAT (429)') : log.paint.red('FAILED')} — ${x.error}`);
        }
        const okAll = results.filter((x) => x.ok);
        const totTok = okAll.reduce((s, x) => s + x.tokens, 0);
        log.plain(`    round wall ${fmtS(wall)} · aggregate ${log.paint.bold((totTok / (wall / 1000)).toFixed(1))} tok/s across ${okAll.length}/${users} ok`);
        requests.push(...results);
    }

    const okAll = requests.filter((x) => x.ok);
    const done = okAll.filter((x) => !x.cancelled);
    const ttfts = okAll.map((x) => x.ttftMs).sort((a, b) => a - b);
    const tps = done.map((x) => x.tps).sort((a, b) => a - b);
    const summary = {
        requests: requests.length,
        ok: okAll.length,
        cancelled: okAll.length - done.length,
        refused: requests.filter((x) => x.status === 429).length,
        failed: requests.filter((x) => !x.ok && x.status !== 429).length,
        ttftP50Ms: ttfts.length ? pct(ttfts, 50) : null,
        ttftP95Ms: ttfts.length ? pct(ttfts, 95) : null,
        tpsMedian: tps.length ? Math.round(pct(tps, 50) * 10) / 10 : null,
    };
    if (okAll.length) {
        log.plain('');
        log.ok(`Summary (${okAll.length} requests): first token p50 ${log.paint.bold(fmtS(summary.ttftP50Ms))} / p95 ${fmtS(summary.ttftP95Ms)}` +
            `${summary.tpsMedian != null ? ` · per-user ${summary.tpsMedian.toFixed(1)} tok/s median` : ''}` +
            `${summary.refused ? ` · ${summary.refused} turned away (no seat)` : ''}${summary.cancelled ? ` · ${summary.cancelled} stopped` : ''}`);
        // Name the engine this config serves with — the Ollama figure is meaningless
        // while llama.cpp or an external server answers.
        if (config) {
            if (config.external && config.external.enabled) log.info(`Reminder: the external server was declared to run ${config.external.parallel} generation(s) at once (external.parallel); the farm cannot verify it.`);
            else if (config.llamacpp && config.llamacpp.enabled) log.info(`Reminder: llama-server runs ${config.llamacpp.parallel} generation(s) at once (llamacpp.parallel); more queue.`);
            else log.info(`Reminder: one Ollama runs ${config.ollama.numParallel} generation(s) at once (ollama.numParallel); more users than that queue.`);
        }
    }
    if (out) {
        const file = path.resolve(out);
        fs.writeFileSync(file, JSON.stringify({
            at: new Date().toISOString(), url, model, users, rounds, maxTokens, cancel, sources: perUser ? 'per-user' : 'one', requests, summary,
        }, null, 2) + '\n', 'utf8');
        log.ok(`Results saved → ${file}`);
    }
    return okAll.length ? 0 : 1;
}

module.exports = { run };
