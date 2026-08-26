// Mock LOL farm for shell E2E testing: UDP beacon + OpenAI-compatible streaming
// endpoint, no GPU needed. Mimics a farm-v0.0.15 box with the llama.cpp backend
// (snapshot advertises the llamacpp alias first + default) and LiteLLM's CORS
// behavior (allow_origins ["*"], no credentials).
//
// Usage (three terminals, see test/e2e.js for the full flow):
//   node test/mock-farm.js [--coordinator]
//
// --coordinator marks the mock as a coordinator so the shell deterministically
// prefers it over any REAL farm broadcasting on the same LAN (pickLeastLoaded
// routes via coordinators) — without it, a live farm with a lower GPU load wins
// the selection and the test talks to the wrong box.
const http = require('http');
const dgram = require('dgram');

const PROXY_PORT = 4009;
const BEACON_PORT = 41998;
const COORDINATOR = process.argv.includes('--coordinator');

const snapshot = () => JSON.stringify({
    v: 1, id: 'mockfarm0001', name: 'Mock Farm', proxyPort: PROXY_PORT, httpPort: 41997,
    ips: ['127.0.0.1'], endpoint: `http://127.0.0.1:${PROXY_PORT}`,
    openaiBaseUrl: `http://127.0.0.1:${PROXY_PORT}/v1`, requiresKey: false,
    models: [
        { id: 'assistant', underlying: 'Qwen3.8-27B-UD-Q2_K_XL', default: true },
        { id: 'gemma4:12b', underlying: 'gemma4:12b', default: false },
    ],
    healthy: true, version: '0.0.15-mock', coordinator: COORDINATOR,
    searxngUrl: null, ttsUrl: null, ttsVoice: null, ttsModel: null, extract: null,
    plugins: {}, recommendedClientPlugins: [], deployments: 1,
    health: { proxyUp: true, hostsUp: 1, hostsTotal: 1, loaded: [] },
    host: { gpu: 'Mock RTX', vramGb: 12, ramGb: 64, cpuCores: 16 },
    usage: { gpuUtil: 3, vramUsedGb: 10.6, vramTotalGb: 12, loaded: [], clients: 0 },
    // What the client renders as "llama.cpp · <weights>" and "N of M slots in use".
    // A farm that predates these sends neither, and the client falls back to a bare
    // client count — worth keeping in mind when changing the farm card.
    backend: {
        engine: 'llama.cpp', alias: 'assistant', model: 'Qwen3.8-27B-UD-Q2_K_XL',
        contextLength: 16384, contextPerSlot: 8192, slots: 2, mtp: true, kvCacheType: 'q4_0',
    },
    capacity: { slots: 2, clients: 1 },
    busy: null,   // set to { label, message, percent } to exercise the switching UI
    ts: Date.now(),
});

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': '*',
    'Access-Control-Allow-Headers': '*',
};

const srv = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(200, CORS); return res.end(); }
    if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json', ...CORS });
        return res.end(JSON.stringify({ data: [{ id: 'assistant' }, { id: 'gemma4:12b' }] }));
    }
    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            console.log('[mock] chat request, model =', (() => { try { return JSON.parse(body).model; } catch { return '?'; } })());
            res.writeHead(200, { 'content-type': 'text/event-stream', ...CORS });
            const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
            let i = 0;
            const R = 100, C = 1000; // 100 reasoning deltas then 1000 content deltas
            // Windows timer resolution is ~15ms, so burst several deltas per tick to
            // reach ~330 deltas/s — above the farm's measured 154.8 tok/s, which is
            // what makes this a real test of the client's streaming render path.
            const iv = setInterval(() => {
                for (let b = 0; b < 5; b++) {
                    if (i < R) send({ choices: [{ delta: { reasoning_content: `think${i} ` } }] });
                    else if (i < R + C) send({ choices: [{ delta: { content: `tok${i - R} ` } }] });
                    else {
                        send({ choices: [], usage: { completion_tokens: C, prompt_tokens: 12 } });
                        res.write('data: [DONE]\n\n');
                        clearInterval(iv);
                        return res.end();
                    }
                    i++;
                }
            }, 15);
            // req 'close' fires on request COMPLETION in modern Node — keying cleanup
            // off it kills the stream before the first delta. The RESPONSE closing is
            // the actual client-went-away signal.
            res.on('close', () => clearInterval(iv));
        });
        return;
    }
    res.writeHead(404, CORS); res.end();
});
srv.listen(PROXY_PORT, '127.0.0.1', () => console.log(`[mock] proxy on 127.0.0.1:${PROXY_PORT}`));

const sock = dgram.createSocket('udp4');
sock.bind(() => {
    setInterval(() => {
        const buf = Buffer.from(snapshot());
        sock.send(buf, 0, buf.length, BEACON_PORT, '127.0.0.1');
    }, 1500);
    console.log(`[mock] beacon → 127.0.0.1:${BEACON_PORT} every 1.5s${COORDINATOR ? ' (coordinator)' : ''}`);
});
