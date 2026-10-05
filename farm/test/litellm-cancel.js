// Does a person's Stop reach the engine? (multi-user plan 0.0) — ONE runnable check, not
// part of `npm test`: it starts a real LiteLLM, which takes ~10–30 s.
//
//   node test/litellm-cancel.js                     farm/.venv's LiteLLM (what `lol install` makes)
//   LOL_LITELLM=<path to litellm(.exe)> node test/litellm-cancel.js
//
// A fake engine streams a token every 100 ms and notes when each request is torn down. It
// speaks all of the farm's deployment shapes, and LiteLLM routes to it with the farm's OWN
// generated config: `hosted_vllm/<alias>` (external servers), `openai/<alias>` (llama.cpp,
// coordinator peers) and `ollama_chat/<model>` (the default Ollama engine), least-busy with 3
// retries, behind the real seat gate. The client aborts mid-answer; the engine must see its
// request close within ~2 s, and LiteLLM must not retry it — streaming, and non-streaming
// (which needs the generated config's general_settings.cancel_on_disconnect). It also checks that drop_params
// keeps the thinking-off pair the client sends (owner decision 9). Loopback, OS-assigned ports
// only — never a live farm's, and no GPU. Exits 0 when every cancel propagates and thinking
// off arrives (or when there is no LiteLLM to test).
//
// Real engines (opt-in, skipped unless LOL_CANCEL_ENGINE is set): does the engine STOP
// GENERATING, not just see the close? One small model on this box's GPU, loopback only:
//
//   LOL_CANCEL_ENGINE=llamacpp LOL_CANCEL_LLAMA_SERVER=<llama-server(.exe)> LOL_CANCEL_GGUF=<model.gguf>
//       node test/litellm-cancel.js
//   LOL_CANCEL_ENGINE=ollama LOL_CANCEL_MODEL=<a pulled tag, e.g. granite4.2:8b>
//       [LOL_CANCEL_OLLAMA=http://127.0.0.1:11434] [LOL_CANCEL_OLLAMA_LOG=<its server.log>] node test/litellm-cancel.js
//   LOL_CANCEL_ENGINE=vllm [LOL_CANCEL_VLLM=http://127.0.0.1:8100/v1] node test/litellm-cancel.js
//
// vllm uses a server that is already running (farm/vllm/serve.sh) and its first served model. Its
// evidence is /metrics, read after each abort (2 s and 3.5 s after it): requests running (0, or 1
// while the other person streams; one more = a retry), tokens generated (nothing after +2 s when
// alone), and requests that ran to max_tokens (none). vLLM's finished_reason="abort" counter does
// not count a client that left (0.30.0, measured 2026-10-05), so it is not used.
//
// llamacpp starts its own llama-server (--parallel 2 --ctx-size 8192 --jinja) on a free port.
// ollama uses the running daemon: it loads the model at the context Ollama picks and unloads
// it (keep_alive 0) at the end. Every path — direct, client → LiteLLM, client → seat gate →
// LiteLLM; streaming and not — asks for a ~2000-token count, aborts 1 s in, and the engine
// must stop within 2 s and not start again (a LiteLLM retry). A control run holds 3 s first,
// to show the count is still generating then. The evidence is the engine's own log, timed as
// it arrives: llama-server's `processing task` / `cancel task` / `release` lines (Ollama 0.34
// runs the same server and writes the same lines to server.log — Linux: `ollama serve 2> file`),
// with nvidia-smi GPU utilisation alongside, and on Ollama how fast a tiny next request is
// answered (with OLLAMA_NUM_PARALLEL=1 it would queue behind a count that did not stop).
// Never /metrics during a trial: llama-server answers it through its result queue, and that
// traffic is what starves a non-streaming cancel (next paragraph).
//
// Found 2026-10-04 on llama.cpp b10670: a NON-streaming request learns its client left only
// when its handler's 1 s wait for a result times out — and server_response::recv_with_timeout
// (tools/server/server-queue.cpp) restarts that wait whenever a result for ANY request is
// posted. Alone on the server it stops ~1 s after the abort; while another person streams (or
// anything polls /metrics or /slots more than once a second) it generates to its end. The
// "while another person streams" trial fails until a pin carries an upstream fix.

const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');
const { defaultConfig } = require('../src/config');
const { buildLitellmConfig, toYaml } = require('../src/litellm');
const { spawnLitellm, venvLitellmPath, killTree } = require('../src/proc');
const { waitForProxy } = require('../src/proxy');
const { createSeats, startSeatGate } = require('../src/seats');
const { waitForLlamacpp, fetchMetrics } = require('../src/llamacpp');

const TOKEN_MS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
async function until(fn, timeoutMs, stepMs = 25) {
    const end = Date.now() + timeoutMs;
    for (;;) {
        const v = fn();
        if (v) return v;
        if (Date.now() > end) return null;
        await sleep(stepMs);
    }
}

// The fake engine. Streaming: a chunk every TOKEN_MS for 30 s. Non-streaming: nothing for 6 s,
// then one answer (an agent page's json_object step looks like this). /api/* = Ollama's API.
const seen = [];
function fakeEngine() {
    return http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            if (req.url.startsWith('/api/show')) {   // LiteLLM may ask Ollama what the model can do
                res.writeHead(200, { 'content-type': 'application/json' });
                return res.end(JSON.stringify({ details: {}, model_info: {}, capabilities: ['completion'] }));
            }
            let j = {};
            try { j = JSON.parse(body || '{}'); } catch { /* keep {} */ }
            const ollama = req.url.startsWith('/api/');
            const r = { stream: !!j.stream, start: Date.now(), closedAt: null, finished: false, tokens: 0, body: j };
            seen.push(r);
            let tick = null; let done = null;
            res.on('close', () => { r.closedAt = Date.now(); r.finished = res.writableEnded; clearInterval(tick); clearTimeout(done); });
            const piece = (text, last) => (ollama
                ? `${JSON.stringify({ model: j.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: text }, done: last, ...(last ? { done_reason: 'stop', prompt_eval_count: 1, eval_count: r.tokens } : {}) })}\n`
                : `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: j.model, choices: [{ index: 0, delta: { content: text }, finish_reason: last ? 'stop' : null }] })}\n\n`);
            if (r.stream) {
                res.writeHead(200, { 'content-type': ollama ? 'application/x-ndjson' : 'text/event-stream' });
                tick = setInterval(() => {
                    r.tokens++;
                    res.write(piece(`t${r.tokens} `, false));
                    if (r.tokens >= 300) { clearInterval(tick); res.end(piece('', true) + (ollama ? '' : 'data: [DONE]\n\n')); }
                }, TOKEN_MS);
            } else {
                done = setTimeout(() => {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(ollama
                        ? JSON.stringify({ model: j.model, created_at: new Date().toISOString(), message: { role: 'assistant', content: 'done' }, done: true, done_reason: 'stop', prompt_eval_count: 1, eval_count: 1 })
                        : JSON.stringify({ id: 'x', object: 'chat.completion', created: 0, model: j.model, choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
                }, j.messages && j.messages[0] && j.messages[0].content === 'quick' ? 200 : 6000);
            }
        });
    });
}

function post(port, model, stream, content, extra = {}) {
    return http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/chat/completions', headers: { 'content-type': 'application/json' } })
        .end(JSON.stringify({ model, messages: [{ role: 'user', content }], stream, ...extra }));
}

// One chat completion through `port`; aborts after 3 content chunks (streaming) or after 1 s
// (non-streaming). Resolves with the abort time.
function askAndAbort(port, model, stream) {
    return new Promise((resolve, reject) => {
        const req = post(port, model, stream, 'count');
        req.on('response', (res) => {
            if (res.statusCode !== 200) { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${b.slice(0, 300)}`))); return; }
            let chunks = 0;
            res.on('data', (c) => {
                chunks += (String(c).match(/"content"/g) || []).length;
                if (stream && chunks >= 3) { const t = Date.now(); req.destroy(); resolve(t); }
            });
            res.on('error', () => { /* our own abort */ });
        });
        req.on('error', (e) => { if (e.code !== 'ECONNRESET' && !/aborted|socket hang up/.test(e.message)) reject(e); });
        if (!stream) setTimeout(() => { const t = Date.now(); req.destroy(); resolve(t); }, 1000);
    });
}

async function trial(label, port, model, stream) {
    const before = seen.length;
    const abortAt = await askAndAbort(port, model, stream);
    await sleep(stream ? 3000 : 7000);   // long enough to see a late close, a finish, or a retry
    const mine = seen.slice(before);
    const first = mine[0];
    const lagMs = first && first.closedAt && !first.finished ? first.closedAt - abortAt : null;
    const after = first ? Math.max(0, first.tokens - Math.floor((abortAt - first.start) / TOKEN_MS)) : null;
    const ok = lagMs != null && lagMs <= 2000 && mine.length === 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: engine saw the close ${lagMs == null ? 'NEVER (it ran to completion)' : `${lagMs} ms after the abort`}` +
        `${stream ? ` (~${after} token(s) generated after it)` : ''}; engine requests: ${mine.length}${mine.length > 1 ? ' (LiteLLM RETRIED a cancelled call)' : ''}`);
    return ok;
}

// A call nobody cancels still answers (cancel_on_disconnect must not break it).
function completes(port, model, extra) {
    return new Promise((resolve) => {
        const req = post(port, model, false, 'quick', extra);
        req.on('response', (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(res.statusCode === 200 && /"done"/.test(b))); });
        req.on('error', () => resolve(false));
    });
}

function litellmVersion(cmd) {
    try {
        const py = path.join(path.dirname(cmd), process.platform === 'win32' ? 'python.exe' : 'python');
        return execFileSync(py, ['-c', 'import importlib.metadata as m; print(m.version("litellm"))'], { encoding: 'utf8' }).trim();
    } catch { return '?'; }   // not a venv layout
}

// LiteLLM on a free loopback port with `doc` as its config, and the real seat gate in front.
async function startStack(doc, cmd) {
    const yamlPath = path.join(os.tmpdir(), `lol-cancel-${process.pid}.yaml`);
    fs.writeFileSync(yamlPath, toYaml(doc), 'utf8');
    const lp = await freePort();
    const cfg = defaultConfig();
    cfg.litellm.command = cmd;
    const child = spawnLitellm(cfg, yamlPath, { port: lp, host: '127.0.0.1', env: { LITELLM_LOCAL_MODEL_COST_MAP: 'True' } });
    let logTail = '';
    const keep = (d) => { logTail = (logTail + d).slice(-4000); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const seats = createSeats({ capacity: () => 4, idleReleaseSec: () => 900 });
    const gate = await startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: lp, seats, idleReleaseSec: () => 900 });
    return {
        lp,
        gp: gate.address().port,
        up: async () => { if (!(await waitForProxy(`http://127.0.0.1:${lp}`, { timeoutMs: 120000 }))) throw new Error(`LiteLLM did not come up:\n${logTail}`); },
        close: async () => { gate.close(); await killTree(child.pid); try { fs.unlinkSync(yamlPath); } catch { /* gone */ } },
    };
}

async function fakeMain(cmd, version) {
    const engine = fakeEngine();
    await new Promise((r) => engine.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${engine.address().port}`;
    // The farm's three routing shapes, generated exactly as `lol up` generates them, in one file:
    // an external server (hosted_vllm/), llama.cpp and coordinator peers (openai/), Ollama (ollama_chat/).
    const ext = defaultConfig();
    ext.llamacpp.enabled = false;
    ext.external = { ...ext.external, enabled: true, alias: 'fake', baseUrl: `${base}/v1` };
    const lcc = defaultConfig();
    lcc.llamacpp = { ...lcc.llamacpp, enabled: true, alias: 'fake-llamacpp', host: '127.0.0.1', port: engine.address().port };
    const oll = defaultConfig();
    oll.llamacpp.enabled = false;
    oll.models = [{ id: 'fake-ollama', default: true }];
    oll.ollama.hosts = [base];
    oll.ollama.contextResolved = 4096;
    const doc = buildLitellmConfig(ext);
    doc.model_list.push(...buildLitellmConfig(lcc).model_list, ...buildLitellmConfig(oll).model_list);
    const shapes = doc.model_list.map((m) => [`${m.litellm_params.model.split('/')[0]}/`, m.model_name]);
    // A builder that stops emitting its shape must fail here, not silently skip that shape's checks.
    if (new Set(shapes.map((s) => s[0])).size !== 3) throw new Error(`expected 3 routing shapes, got ${JSON.stringify(shapes)}`);
    const stack = await startStack(doc, cmd);
    const { lp, gp } = stack;
    console.log(`LiteLLM ${version} (${cmd}) on 127.0.0.1:${lp} → fake engine :${engine.address().port}`);
    let ok = false;
    try {
        await stack.up();
        const results = [];
        for (const [shape, model] of shapes) {
            results.push(await trial(`${shape} stream, client → seat gate → LiteLLM → engine`, gp, model, true));
            results.push(await trial(`${shape} stream, client → LiteLLM → engine (no gate)`, lp, model, true));
            results.push(await trial(`${shape} non-stream, client → seat gate → LiteLLM → engine`, gp, model, false));
            const normal = await completes(gp, model);
            console.log(`${normal ? 'ok  ' : 'FAIL'} ${shape} non-stream, nobody cancels: the answer arrives`);
            results.push(normal);
            // Owner decision 9: thinking off rides as two keys and drop_params must keep both. `openai/`
            // and `hosted_vllm/` pass the body on (vLLM and llama-server read chat_template_kwargs; a
            // coordinator peer running Ollama needs `think`); `ollama_chat/` turns `think` into Ollama's
            // own field.
            const before = seen.length;
            const answered = await completes(gp, model, { chat_template_kwargs: { enable_thinking: false }, think: false });
            const b = (seen[before] && seen[before].body) || {};
            const kept = shape !== 'ollama_chat/'
                ? !!b.chat_template_kwargs && b.chat_template_kwargs.enable_thinking === false && b.think === false
                : b.think === false;
            console.log(`${answered && kept ? 'ok  ' : 'FAIL'} ${shape} thinking off reaches the engine: ` +
                `chat_template_kwargs ${JSON.stringify(b.chat_template_kwargs)}, think ${JSON.stringify(b.think)}${b.options ? `, options ${JSON.stringify(b.options)}` : ''}`);
            results.push(answered && kept);
        }
        ok = results.every(Boolean);
        console.log(ok ? 'PASS: a cancel reaches the engine, and so does thinking off' : 'FAIL: see above');
    } catch (e) {
        console.log(`FAIL: ${e.message}`);
    } finally {
        await stack.close();
        engine.close();
    }
    return ok;
}

// ---- Real engines (LOL_CANCEL_ENGINE) ------------------------------------------------------

const COUNT = 'Count from 1 to 5000, separated by commas. Output only the numbers.';
const MAX_TOKENS = 2000;
const HOLD_MS = 1000;   // the abort comes this long after the engine starts on the request
const STOP_MS = 2000;   // … and the engine must have stopped this soon after it
const IDLE_UTIL = 10;
const openaiBody = (model, stream) => ({ model, messages: [{ role: 'user', content: COUNT }], stream, max_tokens: MAX_TOKENS, temperature: 0 });

function eachLine(stream, fn) {
    let buf = '';
    stream.on('data', (d) => {
        buf += d;
        for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) fn(buf.slice(0, i));
    });
}

// llama-server's per-task log lines as events, timed as they arrive.
function taskLog() {
    const events = [];
    return {
        events,
        line(l) {
            const at = Date.now(); let m;
            if ((m = l.match(/launch_slot_: .*\| task (\d+) \| processing task/))) events.push({ at, kind: 'launch', task: +m[1] });
            else if ((m = l.match(/cancel task, id_task = (\d+)/))) events.push({ at, kind: 'cancel', task: +m[1] });
            else if ((m = l.match(/release: .*\| task (\d+) \| stop processing: n_tokens = (\d+)/))) events.push({ at, kind: 'release', task: +m[1], tokens: +m[2] });
        },
        active() {
            const open = new Set();
            for (const e of events) { if (e.kind === 'launch') open.add(e.task); else if (e.kind === 'release') open.delete(e.task); }
            return open.size;
        },
    };
}

// Follow a file someone else writes (Ollama's server.log), from its current end.
function tailFile(file, fn) {
    let pos = fs.statSync(file).size;
    let buf = '';
    const t = setInterval(() => {
        let size;
        try { size = fs.statSync(file).size; } catch { return; }
        if (size < pos) pos = 0;   // rotated
        if (size === pos) return;
        const b = Buffer.alloc(size - pos);
        const fd = fs.openSync(file, 'r');
        try { fs.readSync(fd, b, 0, b.length, pos); } finally { fs.closeSync(fd); }
        pos = size;
        buf += b.toString('utf8');
        for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) fn(buf.slice(0, i));
    }, 50);
    return () => clearInterval(t);
}

// GPU utilisation every 100 ms (one GPU, LOL_CANCEL_GPU, default 0) — evidence beside the log.
function gpuWatch() {
    const history = [];
    const child = spawn('nvidia-smi', ['-i', process.env.LOL_CANCEL_GPU || '0', '--query-gpu=utilization.gpu,memory.used',
        '--format=csv,noheader,nounits', '-lms', '100'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.on('error', () => { /* no NVIDIA GPU: the log alone is the evidence */ });
    eachLine(child.stdout, (l) => {
        const [util, mib] = l.split(',').map(Number);
        if (Number.isFinite(util)) { history.push({ at: Date.now(), util, mib }); if (history.length > 20000) history.shift(); }
    });
    return { history, stop: () => child.kill() };
}

async function llamacppEngine() {
    const bin = process.env.LOL_CANCEL_LLAMA_SERVER; const gguf = process.env.LOL_CANCEL_GGUF;
    if (!bin || !gguf || !fs.existsSync(bin) || !fs.existsSync(gguf)) return { skip: 'set LOL_CANCEL_LLAMA_SERVER and LOL_CANCEL_GGUF to an existing llama-server and .gguf' };
    const v = spawnSync(bin, ['--version'], { encoding: 'utf8', windowsHide: true });
    const build = (`${v.stdout || ''}${v.stderr || ''}`.match(/build \d+[^)\n]*/) || ['build ?'])[0];
    const port = await freePort();
    const log = taskLog();
    const child = spawn(bin, ['--model', gguf, '--alias', 'cancel-test', '--host', '127.0.0.1', '--port', String(port),
        '--parallel', '2', '--ctx-size', '8192', '--jinja', '--metrics', '--no-webui', '--n-gpu-layers', '999'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    eachLine(child.stdout, log.line); eachLine(child.stderr, log.line);
    if (!(await waitForLlamacpp(port, 300000, () => child.exitCode !== null))) {
        await killTree(child.pid);
        return { fail: 'llama-server did not come up' };
    }
    const cfg = defaultConfig();
    cfg.llamacpp = { ...cfg.llamacpp, enabled: true, alias: 'cancel-test', host: '127.0.0.1', port };
    const direct = { host: '127.0.0.1', port, path: '/v1/chat/completions' };
    return {
        name: `llama.cpp ${build} on :${port}`,
        log,
        doc: buildLitellmConfig(cfg),
        trials: (lp, gp) => {
            const via = (p) => ({ host: '127.0.0.1', port: p, path: '/v1/chat/completions' });
            return [
                ['direct, stream (control: still generating 3 s in)', { ...direct, body: openaiBody('x', true), holdMs: 3000 }],
                ['direct, stream', { ...direct, body: openaiBody('x', true) }],
                ['direct, non-stream', { ...direct, body: openaiBody('x', false) }],
                ['direct, non-stream while another person streams', { ...direct, body: openaiBody('x', false), side: { ...direct, body: openaiBody('x', true) } }],
                ['client → LiteLLM, stream', { ...via(lp), body: openaiBody('cancel-test', true) }],
                ['client → LiteLLM, non-stream', { ...via(lp), body: openaiBody('cancel-test', false) }],
                ['client → seat gate → LiteLLM, stream', { ...via(gp), body: openaiBody('cancel-test', true) }],
                ['client → seat gate → LiteLLM, non-stream', { ...via(gp), body: openaiBody('cancel-test', false) }],
            ];
        },
        // Read once a trial is over — never during one (see the header).
        after: async () => { const m = await fetchMetrics(port); return m ? `; /metrics after: requests_processing ${m['llamacpp:requests_processing']}` : ''; },
        close: () => killTree(child.pid),
    };
}

async function ollamaEngine() {
    const base = (process.env.LOL_CANCEL_OLLAMA || 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const model = process.env.LOL_CANCEL_MODEL;
    const logFile = process.env.LOL_CANCEL_OLLAMA_LOG || [path.join(process.env.LOCALAPPDATA || '', 'Ollama', 'server.log'),
        path.join(os.homedir(), '.ollama', 'logs', 'server.log')].find((f) => fs.existsSync(f));
    if (!model) return { skip: 'set LOL_CANCEL_MODEL to an Ollama tag that is already pulled (e.g. granite4.2:8b)' };
    if (!logFile || !fs.existsSync(logFile)) return { skip: 'no Ollama server.log found — set LOL_CANCEL_OLLAMA_LOG (Linux: run `ollama serve 2> file`)' };
    const call = async (p, body) => (await fetch(base + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json();
    let version;
    try { version = (await call('/api/version')).version; } catch { return { skip: `no Ollama at ${base}` }; }
    // Load the model at the context Ollama picks itself (its /v1 takes no num_ctx), then send that
    // num_ctx on every other path so no trial reloads it.
    await call('/v1/chat/completions', { model, messages: [{ role: 'user', content: 'Reply with: ok' }], max_tokens: 4 });
    const loaded = ((await call('/api/ps')).models || []).find((m) => m.name === model || m.model === model);
    if (!loaded) return { fail: `${model} did not load` };
    const ctx = loaded.context_length || 8192;
    const log = taskLog();
    const stopTail = tailFile(logFile, log.line);
    const cfg = defaultConfig();
    cfg.llamacpp.enabled = false;
    cfg.models = [{ id: model, default: true }];
    cfg.ollama.hosts = [base];
    cfg.ollama.contextResolved = ctx;
    cfg.ollama.keepAlive = '5m';   // a crashed run still frees the GPU
    const u = new URL(base);
    const native = (stream, content = COUNT, n = MAX_TOKENS) => ({ model, messages: [{ role: 'user', content }], stream, options: { num_ctx: ctx, num_predict: n, temperature: 0 }, keep_alive: '5m' });
    const at = (p) => ({ host: u.hostname, port: Number(u.port) || 80, path: p });
    return {
        name: `Ollama ${version} (${model}, num_ctx ${ctx}, log ${logFile})`,
        log,
        doc: buildLitellmConfig(cfg),
        trials: (lp, gp) => {
            const via = (p) => ({ host: '127.0.0.1', port: p, path: '/v1/chat/completions' });
            return [
                ['direct /api/chat, stream (control: still generating 3 s in)', { ...at('/api/chat'), body: native(true), holdMs: 3000 }],
                ['direct /api/chat, stream', { ...at('/api/chat'), body: native(true) }],
                ['direct /api/chat, non-stream', { ...at('/api/chat'), body: native(false) }],
                ['direct /v1, stream', { ...at('/v1/chat/completions'), body: openaiBody(model, true) }],
                ['direct /v1, non-stream', { ...at('/v1/chat/completions'), body: openaiBody(model, false) }],
                ['client → LiteLLM, stream', { ...via(lp), body: openaiBody(model, true) }],
                ['client → LiteLLM, non-stream', { ...via(lp), body: openaiBody(model, false) }],
                ['client → seat gate → LiteLLM, stream', { ...via(gp), body: openaiBody(model, true) }],
                ['client → seat gate → LiteLLM, non-stream', { ...via(gp), body: openaiBody(model, false) }],
            ];
        },
        // The next person is served at once (it would queue behind a live count on OLLAMA_NUM_PARALLEL=1).
        after: async () => {
            const t = Date.now();
            await call('/api/chat', native(false, 'Reply with: ok', 4));
            const ms = Date.now() - t;
            return { text: `; a next request answered in ${ms} ms`, ok: ms <= 3000 };
        },
        close: async () => { stopTail(); try { await call('/api/generate', { model, keep_alive: 0 }); } catch { /* daemon gone */ } },
    };
}

function send({ host, port, path: p, body }) {
    const r = { req: null, ended: null, status: null };
    r.req = http.request({ host, port, method: 'POST', path: p, headers: { 'content-type': 'application/json' }, agent: false });
    r.req.on('response', (res) => { r.status = res.statusCode; res.on('data', () => {}); res.on('end', () => { r.ended = Date.now(); }); res.on('error', () => {}); });
    r.req.on('error', () => { /* our own abort */ });
    r.req.end(JSON.stringify(body));
    return r;
}

async function realTrial(E, gpu, label, t) {
    const say = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${text}`); return ok; };
    await until(() => E.log.active() === 0, 60000);
    await sleep(250);   // the last request's log lines are in before this trial counts its own
    let side = null;
    if (t.side) {   // another person streaming on the other slot, started first
        const from = E.log.events.length;
        side = send(t.side);
        if (!(await until(() => E.log.events.slice(from).some((e) => e.kind === 'launch'), 120000))) return say(false, 'the other person\'s stream never started');
    }
    const from = E.log.events.length;
    const mine = () => E.log.events.slice(from);
    const r = send(t);
    const launch = await until(() => mine().find((e) => e.kind === 'launch'), 120000);
    if (!launch) { r.req.destroy(); return say(false, `the engine never started on it${r.status ? ` (HTTP ${r.status})` : ''}`); }
    await sleep(t.holdMs || HOLD_MS);
    const early = mine().find((e) => e.kind === 'release' && e.task === launch.task);
    if (r.ended || early) { if (side) side.req.destroy(); return say(false, `it finished before the abort (HTTP ${r.status}) — the count is too short to test`); }
    const abortAt = Date.now();
    r.req.destroy();
    // Wait past STOP_MS so a late stop is measured, not just flagged; a count that runs to its end
    // (2000 tokens) is over well within 30 s on any GPU worth testing.
    const rel = await until(() => mine().find((e) => e.kind === 'release' && e.task === launch.task), 30000);
    await sleep(1500);   // a LiteLLM retry would launch a new task here
    const retried = mine().some((e) => e.kind === 'launch' && e.task !== launch.task);
    if (side) side.req.destroy();
    await until(() => E.log.active() === 0, 60000);
    const cancelled = mine().some((e) => e.kind === 'cancel' && e.task === launch.task);
    const lag = rel ? rel.at - abortAt : null;
    const g = gpu.history;
    const before = [...g].reverse().find((s) => s.at <= abortAt);
    const idle = g.find((s) => s.at > abortAt && s.util <= IDLE_UTIL);
    const util = before ? `; GPU ${before.util}% at the abort, ${idle ? `≤${IDLE_UTIL}% ${idle.at - abortAt} ms after` : 'never idle after'}` : '';
    const after = E.after ? await E.after() : '';
    const afterText = typeof after === 'string' ? after : after.text;
    const ok = lag != null && lag <= STOP_MS && cancelled && !retried && (typeof after === 'string' || after.ok);
    return say(ok, `task ${launch.task} ${cancelled ? 'cancelled' : 'NOT cancelled'}, ` +
        `${rel ? `released ${lag} ms after the abort (n_tokens ${rel.tokens})` : 'still generating 30 s after the abort'}` +
        `${retried ? '; a NEW task started after it (a retry)' : ''}${util}${afterText}`);
}

async function vllmEngine() {
    const base = (process.env.LOL_CANCEL_VLLM || 'http://127.0.0.1:8100/v1').replace(/\/+$/, '');
    let model;
    try { model = (await (await fetch(`${base}/models`)).json()).data[0].id; } catch { return { skip: `no vLLM answering at ${base}/models (start farm/vllm/serve.sh)` }; }
    const metricsUrl = `${base.replace(/\/v1$/, '')}/metrics`;
    const sum = (m, pred) => Object.keys(m).filter(pred).reduce((s, k) => s + m[k], 0);
    const cfg = defaultConfig();
    cfg.llamacpp.enabled = false;
    cfg.external = { ...cfg.external, enabled: true, alias: 'cancel-test', baseUrl: base, model };
    const u = new URL(base);
    const direct = { host: u.hostname, port: Number(u.port) || 80, path: `${u.pathname}/chat/completions` };
    return {
        name: `vLLM ${model} at ${base}`,
        doc: buildLitellmConfig(cfg),
        trial: vllmTrial,
        metrics: async () => {
            const m = await fetchMetrics(metricsUrl);
            if (!m) throw new Error(`no /metrics at ${metricsUrl}`);
            return {
                running: sum(m, (k) => k.startsWith('vllm:num_requests_running{')),
                gen: sum(m, (k) => k.startsWith('vllm:generation_tokens_total{')),
                length: sum(m, (k) => k.startsWith('vllm:request_success_total{') && k.includes('finished_reason="length"')),
            };
        },
        trials: (lp, gp) => {
            const via = (p) => ({ host: '127.0.0.1', port: p, path: '/v1/chat/completions' });
            const stream = (to, m) => ({ ...to, body: openaiBody(m, true) });
            return [
                ['direct, stream (control: still generating 3 s in)', { ...stream(direct, model), holdMs: 3000 }],
                ['direct, stream', stream(direct, model)],
                ['direct, non-stream', { ...direct, body: openaiBody(model, false) }],
                ['direct, non-stream while another person streams', { ...direct, body: openaiBody(model, false), side: stream(direct, model) }],
                ['client → LiteLLM, stream', stream(via(lp), 'cancel-test')],
                ['client → LiteLLM, non-stream', { ...via(lp), body: openaiBody('cancel-test', false) }],
                ['client → seat gate → LiteLLM, stream', stream(via(gp), 'cancel-test')],
                ['client → seat gate → LiteLLM, non-stream', { ...via(gp), body: openaiBody('cancel-test', false) }],
                ['client → seat gate → LiteLLM, stream while another person streams', { ...stream(via(gp), 'cancel-test'), side: stream(via(gp), 'cancel-test') }],
                ['client → seat gate → LiteLLM, non-stream while another person streams', { ...via(gp), body: openaiBody('cancel-test', false), side: stream(via(gp), 'cancel-test') }],
            ];
        },
        close: async () => {},
    };
}

// One vLLM trial: /metrics before, then 2 s and 3.5 s after the abort (see the header).
async function vllmTrial(E, gpu, label, t) {
    const say = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${text}`); return ok; };
    const settle = async (want) => { for (let i = 0; i < 300; i++) { if ((await E.metrics()).running <= want) return true; await sleep(200); } return false; };
    if (!(await settle(0))) return say(false, 'the engine never went idle before the trial');
    let side = null;
    if (t.side) {   // another person streaming, started first
        side = send(t.side);
        let started = false;
        for (let i = 0; i < 300 && !started; i++) { started = (await E.metrics()).running >= 1; if (!started) await sleep(200); }
        if (!started) { side.req.destroy(); return say(false, 'the other person\'s stream never started'); }
    }
    const m0 = await E.metrics();
    const r = send(t);
    await sleep(t.holdMs || HOLD_MS);   // an idle vLLM starts in tens of ms
    if (r.ended) { if (side) side.req.destroy(); return say(false, `it finished before the abort (HTTP ${r.status}) — the count is too short to test`); }
    const abortAt = Date.now();
    r.req.destroy();
    await sleep(STOP_MS);
    const m1 = await E.metrics();
    await sleep(1500);   // a LiteLLM retry would be running here
    const m2 = await E.metrics();
    if (side) side.req.destroy();
    await settle(0);
    const want = side ? 1 : 0;
    const g = gpu.history;
    const before = [...g].reverse().find((s) => s.at <= abortAt);
    const idle = !side && g.find((s) => s.at > abortAt && s.util <= IDLE_UTIL);
    const util = before ? `; GPU ${before.util}% at the abort${side ? '' : `, ${idle ? `≤${IDLE_UTIL}% ${idle.at - abortAt} ms after` : 'never idle after'}`}` : '';
    const ok = m1.running === want && m2.running === want && m2.length === m0.length && (side || m2.gen === m1.gen);
    return say(ok, `requests running ${m1.running} at +2 s and ${m2.running} at +3.5 s (want ${want}); ` +
        `${m1.gen - m0.gen} tokens generated from the send to +2 s${side ? ' (both people)' : ''}, ${m2.gen - m1.gen} after; ` +
        `${m2.length - m0.length} ran to max_tokens${util}`);
}

async function realMain(cmd, version) {
    const kind = process.env.LOL_CANCEL_ENGINE;
    const E = kind === 'llamacpp' ? await llamacppEngine()
        : kind === 'ollama' ? await ollamaEngine()
            : kind === 'vllm' ? await vllmEngine()
                : { skip: `LOL_CANCEL_ENGINE=${kind}: use llamacpp, ollama or vllm` };
    if (E.skip) { console.log(`skipped: ${E.skip}`); return true; }
    if (E.fail) { console.log(`FAIL: ${E.fail}`); return false; }
    const gpu = gpuWatch();
    const stack = await startStack(E.doc, cmd);
    console.log(`${E.name}; LiteLLM ${version} on 127.0.0.1:${stack.lp}, seat gate :${stack.gp}`);
    let ok = false;
    try {
        await stack.up();
        const results = [];
        for (const [label, t] of E.trials(stack.lp, stack.gp)) results.push(await (E.trial || realTrial)(E, gpu, label, t));
        ok = results.every(Boolean);
        console.log(ok ? 'PASS: the engine stops generating when the client leaves' : 'FAIL: the engine kept generating for a client that left (see above)');
    } catch (e) {
        console.log(`FAIL: ${e.message}`);
    } finally {
        await stack.close();
        await E.close();
        await sleep(2000);
        const last = gpu.history[gpu.history.length - 1];
        if (last) console.log(`GPU after cleanup: ${last.mib} MiB used, ${last.util}%`);
        gpu.stop();
    }
    return ok;
}

(async () => {
    const cmd = process.env.LOL_LITELLM || venvLitellmPath();
    if (!cmd || !fs.existsSync(cmd)) { console.log('skipped: no LiteLLM (run `lol install`, or set LOL_LITELLM)'); return; }
    const version = litellmVersion(cmd);
    const ok = process.env.LOL_CANCEL_ENGINE ? await realMain(cmd, version) : await fakeMain(cmd, version);
    process.exit(ok ? 0 : 1);
})();
