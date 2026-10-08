// A stand-in Ollama for farm/test/vllm-lifecycle.js: no model, no GPU, loopback only.
//   /api/version, /api/tags (the models it "has"), /api/ps (the ones "loaded"), /api/show (a context length),
//   /api/generate (a warm-up loads, keep_alive 0 unloads — the farm's eviction, recorded), /api/chat (a tiny
//   reply, streamed as NDJSON or not: what LiteLLM's ollama_chat/ asks when the farm falls back to Ollama).
// `requests` keeps one line per call ("POST /api/generate unload fake-ollama:1b"), for the test to read.
// /api/pull streams a download's progress for `knobs.pullMs` (a test sets it), then succeeds.
//   node test/fake-ollama.js [port]   (standalone)

const http = require('http');

function startFakeOllama(port, { models = ['fake-ollama:1b'], loaded = models.slice(0, 1) } = {}) {
    const inVram = new Set(loaded);
    const requests = [];
    const knobs = { pullMs: 3000 };
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            let j = {};
            try { j = JSON.parse(raw || '{}'); } catch { /* not JSON */ }
            const p = (req.url || '').split('?')[0];
            const send = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
            requests.push(`${req.method} ${p}${p === '/api/generate' && j.keep_alive === 0 ? ` unload ${j.model}` : ''}`);
            if (p === '/api/version') return send({ version: '0.34.0-fake' });
            if (p === '/api/tags') return send({ models: models.map((name) => ({ name, model: name, size: 1e9, details: { family: 'fake', parameter_size: '1B' } })) });
            if (p === '/api/ps') return send({ models: [...inVram].map((name) => ({ name, model: name, size: 1e9, size_vram: 1e9 })) });
            if (p === '/api/show') return send({ model_info: { 'general.architecture': 'fake', 'fake.context_length': 8192 }, details: { family: 'fake' }, capabilities: ['completion'] });
            if (p === '/api/generate') {
                if (j.keep_alive === 0) inVram.delete(j.model); else inVram.add(j.model);
                return send({ model: j.model, response: '', done: true });
            }
            if (p === '/api/chat') {
                inVram.add(j.model);
                const end = { model: j.model, created_at: new Date().toISOString(), done: true, done_reason: 'stop', prompt_eval_count: 3, eval_count: 3 };
                if (j.stream === false) return send({ ...end, message: { role: 'assistant', content: 'fake ollama reply' } });
                res.writeHead(200, { 'content-type': 'application/x-ndjson' });
                res.write(`${JSON.stringify({ model: j.model, created_at: end.created_at, message: { role: 'assistant', content: 'fake ollama reply' }, done: false })}\n`);
                return res.end(`${JSON.stringify({ ...end, message: { role: 'assistant', content: '' } })}\n`);
            }
            if (p === '/api/pull') {
                res.writeHead(200, { 'content-type': 'application/x-ndjson' });
                const t0 = Date.now(); const total = 1e9;
                const tick = setInterval(() => {
                    const part = Math.min(1, (Date.now() - t0) / knobs.pullMs);
                    if (part >= 1) {
                        clearInterval(tick);
                        if (!models.includes(j.model)) models.push(j.model);
                        return res.end(`${JSON.stringify({ status: 'success' })}\n`);
                    }
                    res.write(`${JSON.stringify({ status: 'pulling 0123456789ab', digest: 'sha256:0123456789ab', total, completed: Math.round(part * total) })}\n`);
                }, 500);
                res.on('close', () => clearInterval(tick));
                return undefined;
            }
            return send({ error: 'not here' }, 404);
        });
    });
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve({ server, requests, inVram, knobs, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) }));
    });
}

module.exports = { startFakeOllama };

if (require.main === module) {
    const port = Number(process.argv[2] || 11500);
    startFakeOllama(port).then(() => console.log(`fake Ollama on 127.0.0.1:${port}`));
}
