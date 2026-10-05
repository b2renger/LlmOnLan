// The farms a client meets in the field, as their snapshots cross the wire (JSON, so an undefined
// value is simply absent): what THIS farm sends with each engine, built by the real buildSnapshot(),
// and what farm-v0.0.41 sent (snapshot.farm-v0.0.41.json: that release's own buildSnapshot, run with
// the Farm app's defaults of the time; it predates capacity.mine). farm/test/run.js checks every one
// against snapshot.schema.json; shell/test/chat/unit/farm-contract.test.mjs has the client read them.
// A new engine, plugin or seat state belongs here.

const { defaultConfig } = require('../src/config');
const { buildSnapshot } = require('../src/snapshot');

const wire = (snap) => JSON.parse(JSON.stringify(snap));
const plugin = (label, on) => ({ label, runsOn: 'farm', enabled: on, healthy: on });
const plugins = (on) => ({
    websearch: plugin('Web search', true),
    tts: plugin('Voice (TTS)', on),
    ocr: plugin('Document OCR', true),
    bus: plugin('Message bus (MQTT · WebSocket · OSC)', on),
    classify: plugin('Classify (Laya)', on),
    stt: plugin('Speech to text', on),
});
const seatsOf = (...ips) => ips.map((ip) => ({ ip, since: 0, lastActive: 0 }));

function examples() {
    // Ollama, the default engine: an open farm, web search and OCR on, the seat gate on. Asked by the
    // client that holds the seat (GET /lol/self), and the same farm's beacon.
    const ollama = defaultConfig();
    ollama.ollama.contextResolved = 32768;   // what `lol up` measured
    const ollamaHealth = {
        proxyUp: true, hostsUp: 1, hostsTotal: 1, loaded: ['gemma4:12b'], engineUp: true,
        host: { gpu: 'NVIDIA GeForce RTX 4070', vramGb: 12, ramGb: 64, cpuCores: 16 },
        gpu: { gpuUtil: 7, vramUsedGb: 10.4, vramTotalGb: 12 },
        clientsConnected: 3, getSeats: () => seatsOf('10.0.0.21'),
        searxngUp: true, extractUp: true, extractKey: 'ocr-key', plugins: plugins(false),
        deployments: 1, getJob: () => null, perf: null,
    };

    // llama.cpp with a farm password: the plugin keys leave the snapshot, every plugin is up, the
    // seats are full and a model switch is running.
    const llama = defaultConfig();
    Object.assign(llama.llamacpp, { enabled: true, parallel: 2, contextResolved: 65536 });
    llama.proxy.masterKey = 'farm-password';
    for (const k of ['tts', 'classify', 'stt', 'bus']) llama[k].enabled = true;
    const llamaHealth = {
        proxyUp: true, hostsUp: 1, hostsTotal: 1, loaded: [], engineUp: true,
        host: { gpu: 'NVIDIA RTX A6000', vramGb: 48, ramGb: 128, cpuCores: 32 },
        gpu: { gpuUtil: 96, vramUsedGb: 21.5, vramTotalGb: 48 },
        clientsConnected: 4, getSeats: () => seatsOf('10.0.0.21', '10.0.0.22'),
        searxngUp: true, ttsUp: true, busUp: true,
        extractUp: true, extractKey: 'ocr-key', classifyUp: true, classifyKey: 'laya-key', sttUp: true, sttKey: 'stt-key',
        plugins: plugins(true), deployments: 1,
        getJob: () => ({ kind: 'model', label: 'Loading Qwen3.8-27B-UD-IQ2_S', message: 'Loading the weights…', percent: 40 }),
        perf: { engine: 'llama.cpp', genTokSec: 31.2, lastGenTokSec: 31.2, lastPromptTokSec: 905, lastCacheHitRatio: 0.82, lastActiveTs: 1790577087000, busySlots: 2, totalSlots: 2, queued: 1, kvUsed: null },
    };

    // An operator-run vLLM (the external engine) on a coordinator that balances two peers, its live
    // load read from the server's /metrics.
    const vllm = defaultConfig();
    Object.assign(vllm.external, { enabled: true, label: 'Qwen3.6-35B-A3B NVFP4 (vLLM)', contextLength: 65536, parallel: 48 });
    const vllmHealth = {
        proxyUp: true, hostsUp: 1, hostsTotal: 1, loaded: [], engineUp: true, coordinator: true, deployments: 3,
        host: { gpu: 'NVIDIA RTX PRO 6000 Blackwell', vramGb: 96, ramGb: 256, cpuCores: 48 },
        gpu: { gpuUtil: 88, vramUsedGb: 90.1, vramTotalGb: 96 },
        clientsConnected: 28, getSeats: () => seatsOf(...Array.from({ length: 25 }, (_, i) => `10.0.0.${30 + i}`)),
        searxngUp: true, extractUp: true, extractKey: 'ocr-key', plugins: plugins(false), getJob: () => null,
        perf: { engine: 'vllm', genTokSec: 48, lastGenTokSec: 50, lastThroughputTokSec: 1210, lastCacheHitRatio: 0.75, lastDraftAcceptRatio: 0.7, kvPoolTokens: 1310720, lastActiveTs: 1790577087000, busySlots: 24, totalSlots: 48, queued: 0, kvUsed: 0.42 },
    };

    // An Ollama somebody else started, the seat gate and every plugin off, the engine down: the
    // nulls a client must read without stumbling.
    const bare = defaultConfig();
    bare.proxy.seatGate = false;
    bare.websearch.enabled = false;
    bare.ocr.enabled = false;
    const bareHealth = { proxyUp: true, hostsUp: 0, hostsTotal: 1, ollamaManaged: false };

    return [
        { label: 'Ollama, open, GET /lol/self from the seat holder', snap: wire(buildSnapshot(ollama, ollamaHealth, '10.0.0.21')) },
        { label: 'Ollama, open, beacon', snap: wire(buildSnapshot(ollama, ollamaHealth)) },
        { label: 'llama.cpp, password, every plugin, seats full, a model switch', snap: wire(buildSnapshot(llama, llamaHealth, '10.0.0.40')) },
        { label: 'external vLLM, coordinator', snap: wire(buildSnapshot(vllm, vllmHealth, '10.0.0.30')) },
        { label: 'Ollama not started by the farm, gate and plugins off, engine down', snap: wire(buildSnapshot(bare, bareHealth)) },
        { label: 'farm-v0.0.41, GET /lol/self', snap: wire(require('./snapshot.farm-v0.0.41.json')) },
    ];
}

module.exports = examples;
