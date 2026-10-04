// Does a person's Stop reach the engine? (multi-user plan 0.0) — ONE runnable check, not
// part of `npm test`: it starts a real LiteLLM, which takes ~10–30 s.
//
//   node test/litellm-cancel.js                     farm/.venv's LiteLLM (what `lol install` makes)
//   LOL_LITELLM=<path to litellm(.exe)> node test/litellm-cancel.js
//
// A fake engine streams a token every 100 ms and notes when each request is torn down. It
// speaks both of the farm's deployment shapes, and LiteLLM routes to it with the farm's OWN
// generated config: `openai/<alias>` (llama.cpp, external servers, coordinator peers) and
// `ollama_chat/<model>` (the default Ollama engine), least-busy with 3 retries, behind the
// real seat gate. The client aborts mid-answer; the engine must see its request close within
// ~2 s, and LiteLLM must not retry it — streaming, and non-streaming (which needs the
// generated config's general_settings.cancel_on_disconnect). Loopback, OS-assigned ports
// only — never a live farm's, and no GPU. Exits 0 when every cancel propagates (or when
// there is no LiteLLM to test).

const http = require('http');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { defaultConfig } = require('../src/config');
const { buildLitellmConfig, toYaml } = require('../src/litellm');
const { spawnLitellm, venvLitellmPath, killTree } = require('../src/proc');
const { waitForProxy } = require('../src/proxy');
const { createSeats, startSeatGate } = require('../src/seats');

const TOKEN_MS = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

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
            const r = { stream: !!j.stream, start: Date.now(), closedAt: null, finished: false, tokens: 0 };
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

function post(port, model, stream, content) {
    return http.request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/chat/completions', headers: { 'content-type': 'application/json' } })
        .end(JSON.stringify({ model, messages: [{ role: 'user', content }], stream }));
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
function completes(port, model) {
    return new Promise((resolve) => {
        const req = post(port, model, false, 'quick');
        req.on('response', (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve(res.statusCode === 200 && /"done"/.test(b))); });
        req.on('error', () => resolve(false));
    });
}

(async () => {
    const cmd = process.env.LOL_LITELLM || venvLitellmPath();
    if (!cmd || !fs.existsSync(cmd)) { console.log('skipped: no LiteLLM (run `lol install`, or set LOL_LITELLM)'); return; }
    let version = '?';
    try {
        const py = path.join(path.dirname(cmd), process.platform === 'win32' ? 'python.exe' : 'python');
        version = execFileSync(py, ['-c', 'import importlib.metadata as m; print(m.version("litellm"))'], { encoding: 'utf8' }).trim();
    } catch { /* not a venv layout */ }

    const engine = fakeEngine();
    await new Promise((r) => engine.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${engine.address().port}`;
    // The farm's two routing shapes, generated exactly as `lol up` generates them, in one file.
    const ext = defaultConfig();
    ext.llamacpp.enabled = false;
    ext.external = { ...ext.external, enabled: true, alias: 'fake', baseUrl: `${base}/v1` };
    ext.litellm.command = cmd;
    const oll = defaultConfig();
    oll.llamacpp.enabled = false;
    oll.models = [{ id: 'fake-ollama', default: true }];
    oll.ollama.hosts = [base];
    oll.ollama.contextResolved = 4096;
    const doc = buildLitellmConfig(ext);
    doc.model_list.push(...buildLitellmConfig(oll).model_list);
    const yamlPath = path.join(os.tmpdir(), `lol-cancel-${process.pid}.yaml`);
    fs.writeFileSync(yamlPath, toYaml(doc), 'utf8');
    const lp = await freePort();
    console.log(`LiteLLM ${version} (${cmd}) on 127.0.0.1:${lp} → fake engine :${engine.address().port}`);
    const child = spawnLitellm(ext, yamlPath, { port: lp, host: '127.0.0.1', env: { LITELLM_LOCAL_MODEL_COST_MAP: 'True' } });
    let logTail = '';
    const keep = (d) => { logTail = (logTail + d).slice(-4000); };
    child.stdout.on('data', keep); child.stderr.on('data', keep);
    const seats = createSeats({ capacity: () => 4, idleReleaseSec: () => 900 });
    const gate = await startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: lp, seats, idleReleaseSec: () => 900 });
    const gp = gate.address().port;
    let ok = false;
    try {
        if (!(await waitForProxy(`http://127.0.0.1:${lp}`, { timeoutMs: 120000 }))) throw new Error(`LiteLLM did not come up:\n${logTail}`);
        const results = [];
        for (const [shape, model] of [['openai/', 'fake'], ['ollama_chat/', 'fake-ollama']]) {
            results.push(await trial(`${shape} stream, client → seat gate → LiteLLM → engine`, gp, model, true));
            results.push(await trial(`${shape} stream, client → LiteLLM → engine (no gate)`, lp, model, true));
            results.push(await trial(`${shape} non-stream, client → seat gate → LiteLLM → engine`, gp, model, false));
            const normal = await completes(gp, model);
            console.log(`${normal ? 'ok  ' : 'FAIL'} ${shape} non-stream, nobody cancels: the answer arrives`);
            results.push(normal);
        }
        ok = results.every(Boolean);
        console.log(ok ? 'PASS: a cancel reaches the engine' : 'FAIL: a cancel does not reach the engine (see above)');
    } catch (e) {
        console.log(`FAIL: ${e.message}`);
    } finally {
        gate.close();
        await killTree(child.pid);
        engine.close();
        try { fs.unlinkSync(yamlPath); } catch { /* gone */ }
    }
    process.exit(ok ? 0 : 1);
})();
