// Minimal dependency-free unit tests for the pure pieces of the farm CLI
// (config validation, LiteLLM generation, snapshot, ollama helpers). Run with
// `npm test` in farm/. Network-touching commands are smoke-tested separately.

const assert = require('assert');
const yaml = require('js-yaml');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0;
const tests = [];
// Collect tests, then run them (awaiting each) in the IIFE at the bottom so async
// test fns are handled correctly alongside the sync ones.
const test = (name, fn) => tests.push({ name, fn });

// ---- config ----------------------------------------------------------------
const { defaultConfig, ConfigSchema } = require('../src/config');

test('defaultConfig materializes all defaults', () => {
    const c = defaultConfig();
    assert.equal(c.proxy.port, 4000);
    assert.equal(c.beacon.group, '239.255.43.10');
    assert.notEqual(c.beacon.group, '239.255.42.99', 'must differ from ComfyQ');
    assert.equal(c.ollama.hosts[0], 'http://127.0.0.1:11434');
    assert.equal(c.litellm.provider, 'ollama_chat');
    assert.ok(c.models.length >= 1);
});

test('config rejects unknown keys (strict)', () => {
    const r = ConfigSchema.safeParse({ bogus: 1 });
    assert.equal(r.success, false);
});

test('config rejects a non-url ollama host', () => {
    const r = ConfigSchema.safeParse({ ollama: { hosts: ['not a url'] } });
    assert.equal(r.success, false);
});

// ---- litellm generation ----------------------------------------------------
const { buildLitellmConfig, toYaml, modelSupportsVision, servedEntries } = require('../src/litellm');

test('litellm config = models × hosts deployments', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;   // this test pins the Ollama routing path
    c.models = [{ id: 'gemma4:12b', default: true }, { id: 'qwen3:8b' }];
    c.ollama.hosts = ['http://a:11434', 'http://b:11434'];
    const doc = buildLitellmConfig(c);
    assert.equal(doc.model_list.length, 4, '2 models × 2 hosts');
    // Same model_name across hosts → router load-balances.
    const gemma = doc.model_list.filter((d) => d.model_name === 'gemma4:12b');
    assert.equal(gemma.length, 2);
    assert.equal(gemma[0].litellm_params.model, 'ollama_chat/gemma4:12b');
    assert.ok(['http://a:11434', 'http://b:11434'].includes(gemma[0].litellm_params.api_base));
    // Context window rides the routing (→ Ollama options.num_ctx on EVERY host) —
    // this is what makes ollama.contextLength apply per request + panel-adjustable.
    assert.equal(gemma[0].litellm_params.num_ctx, 16384);
    // least-busy = live-load routing: a box mid-generation stops receiving new
    // work while an idle deployment takes it (the PAIR idea, inside LiteLLM).
    assert.equal(doc.router_settings.routing_strategy, 'least-busy');
    assert.equal(doc.litellm_settings.telemetry, false);
});

test('litellm master_key only present when configured', () => {
    const c = defaultConfig();
    assert.ok(!('master_key' in buildLitellmConfig(c).general_settings));
    c.proxy.masterKey = 'sk-secret';
    assert.equal(buildLitellmConfig(c).general_settings.master_key, 'sk-secret');
});

test('generated yaml round-trips', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;   // this test pins the Ollama routing path
    const doc = buildLitellmConfig(c);
    const parsed = yaml.load(toYaml(doc));
    assert.deepEqual(parsed.model_list[0].model_name, c.models[0].id);
});

test('vision-capable models are inferred from the tag', () => {
    for (const id of ['gemma4:12b', 'gemma-4', 'llava:13b', 'llama3.2-vision', 'qwen2.5vl:7b', 'qwen2-vl', 'minicpm-v', 'moondream'])
        assert.equal(modelSupportsVision({ id }), true, `${id} should be vision`);
    for (const id of ['qwen2.5-coder:7b', 'llama3.1:8b', 'qwen3:8b', 'mistral:7b'])
        assert.equal(modelSupportsVision({ id }), false, `${id} should be text-only`);
});

test('explicit vision flag overrides tag inference', () => {
    assert.equal(modelSupportsVision({ id: 'qwen2.5-coder:7b', vision: true }), true);
    assert.equal(modelSupportsVision({ id: 'gemma4:12b', vision: false }), false);
});

test('litellm flags supports_vision so the proxy keeps images (drop_params)', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;   // these exercise the OLLAMA engine's routing
    c.models = [{ id: 'gemma4:12b', default: true }, { id: 'qwen2.5-coder:7b' }];
    const doc = buildLitellmConfig(c);
    const gemma = doc.model_list.find((d) => d.model_name === 'gemma4:12b');
    const coder = doc.model_list.find((d) => d.model_name === 'qwen2.5-coder:7b');
    assert.equal(gemma.model_info.supports_vision, true, 'gemma4 is multimodal');
    assert.ok(!coder.model_info, 'a text-only model carries no vision flag');
});

test('coordinator config default is false', () => {
    assert.equal(defaultConfig().coordinator, false);
});

test('coordinator aggregates peer farms as openai deployments', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;   // these exercise the OLLAMA engine's routing
    c.models = [{ id: 'gemma4:12b', default: true }];
    c.ollama.hosts = ['http://127.0.0.1:11434'];
    const peers = [
        { openaiBaseUrl: 'http://10.0.0.9:4000/v1', models: [{ id: 'gemma4:12b' }] },
        { openaiBaseUrl: 'http://10.0.0.8:4000/v1', models: ['gemma4:12b'] }, // string form too
    ];
    const deps = buildLitellmConfig(c, peers).model_list.filter((d) => d.model_name === 'gemma4:12b');
    assert.equal(deps.length, 3, '1 local + 2 peers all share the model_name → router balances');
    const peerDep = deps.find((d) => d.litellm_params.api_base === 'http://10.0.0.9:4000/v1');
    assert.equal(peerDep.litellm_params.model, 'openai/gemma4:12b', 'peer talks OpenAI, not ollama_chat');
    assert.ok(peerDep.litellm_params.api_key, 'peer deployment carries a key string');
    assert.equal(peerDep.model_info.supports_vision, true, 'vision preserved on peer deployments');
});

test('coordinator skips a peer that does not serve the model', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;   // Ollama-engine routing
    c.models = [{ id: 'gemma4:12b', default: true }];
    const peers = [{ openaiBaseUrl: 'http://10.0.0.7:4000/v1', models: [{ id: 'llama3.1:8b' }] }];
    const deps = buildLitellmConfig(c, peers).model_list.filter((d) => d.model_name === 'gemma4:12b');
    assert.equal(deps.length, 1, 'only the local host; the peer serves a different model');
});

test('modelAlias config default is null', () => {
    assert.equal(defaultConfig().modelAlias, null);
});

test('global modelAlias renames the DEFAULT model; other picked models still serve', () => {
    const c = defaultConfig();
    c.models = [{ id: 'qwen3.6:35b', default: true }, { id: 'gemma4:12b' }];
    c.modelAlias = 'assistant';
    const e = servedEntries(c);
    assert.equal(e.length, 2, 'multi-pick no longer collapses to one');
    assert.deepEqual(e.map((x) => x.servedName), ['assistant', 'gemma4:12b']);
    assert.equal(e[0].underlying, 'qwen3.6:35b', 'alias is backed by the default picked model');
    assert.equal(e[0].isDefault, true);
});

test('per-model alias serves role names; wins over the global alias', () => {
    const c = defaultConfig();
    c.modelAlias = 'assistant';
    c.models = [
        { id: 'gemma4:12b', default: true },                     // → global alias
        { id: 'qwen2.5-coder:14b', alias: 'coder' },             // → own alias
    ];
    const e = servedEntries(c);
    assert.deepEqual(e.map((x) => x.servedName), ['assistant', 'coder']);
    c.models[0].alias = 'chat';                                  // own alias beats global
    assert.equal(servedEntries(c)[0].servedName, 'chat');
});

test('multi-alias flows into litellm model_names and the snapshot', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;   // this test pins the Ollama alias path
    c.models = [
        { id: 'gemma4:12b', default: true, alias: 'assistant' },
        { id: 'qwen2.5-coder:14b', alias: 'coder' },
    ];
    const names = buildLitellmConfig(c).model_list.map((d) => d.model_name);
    assert.deepEqual(names, ['assistant', 'coder']);
    const snap = buildSnapshot(c, { proxyUp: true, hostsUp: 1 });
    assert.deepEqual(snap.models, [
        { id: 'assistant', underlying: 'gemma4:12b', default: true },
        { id: 'coder', underlying: 'qwen2.5-coder:14b', default: false },
    ]);
});

test('a picked model keeps its config explicit vision flag (not just alias)', async () => {
    const c = defaultConfig();
    c.models = [{ id: 'my-multimodal:latest', vision: true, alias: 'assistant', default: true }];
    const got = await selectModels(c, [], ['--model', 'my-multimodal:latest']);
    assert.equal(got[0].vision, true, 'explicit vision survives the pick (else images get dropped)');
    assert.equal(got[0].alias, 'assistant');
    // and it flows to supports_vision even though the tag regex can't infer it
    const dep = buildLitellmConfig({ ...c, models: got }).model_list[0];
    assert.equal(dep.model_info.supports_vision, true);
});

test('--model id=alias attaches the alias; interactive picks keep config aliases', async () => {
    const c = defaultConfig();
    c.models = [{ id: 'qwen2.5-coder:14b', alias: 'coder', default: true }];
    const got = await selectModels(c, [], ['--model', 'qwen3:8b=assistant,qwen2.5-coder:14b']);
    assert.deepEqual(got, [
        { id: 'qwen3:8b', default: true, alias: 'assistant' },    // explicit =alias
        { id: 'qwen2.5-coder:14b', default: false, alias: 'coder' }, // config alias kept
    ]);
});

test('alias mode: litellm exposes the alias as model_name, routed to the real model', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;   // this test pins the Ollama routing path
    c.models = [{ id: 'qwen3.6:35b', default: true }];
    c.ollama.hosts = ['http://127.0.0.1:11434'];
    c.modelAlias = 'assistant';
    const doc = buildLitellmConfig(c);
    assert.equal(doc.model_list.length, 1);
    assert.equal(doc.model_list[0].model_name, 'assistant', 'clients see the stable alias');
    assert.equal(doc.model_list[0].litellm_params.model, 'ollama_chat/qwen3.6:35b', 'routed to the real model');
});

// ---- litellm command resolution (proc) -------------------------------------
const { resolveLitellmCommand, venvLitellmPath } = require('../src/proc');

test('resolveLitellmCommand honors an explicit litellm.command', () => {
    const c = defaultConfig();
    c.litellm.command = '/opt/litellm/bin/litellm';
    assert.equal(resolveLitellmCommand(c), '/opt/litellm/bin/litellm');
});

test('resolveLitellmCommand defaults to the .venv litellm, else PATH', () => {
    const c = defaultConfig(); // litellm.command defaults to 'litellm'
    assert.equal(resolveLitellmCommand(c), venvLitellmPath() || 'litellm');
});

// ---- snapshot --------------------------------------------------------------
const { buildSnapshot } = require('../src/snapshot');

test('snapshot carries the discovery contract', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;   // Ollama-only path; llamacpp advertising has its own test
    const s = buildSnapshot(c, { proxyUp: true, hostsUp: 1, hostsTotal: 1 });
    assert.equal(s.v, 1);
    assert.ok(s.id && s.id.length >= 8);
    assert.equal(s.proxyPort, 4000);
    assert.equal(s.httpPort, 41997, 'admin/discovery port advertised for the admin page URL');
    assert.ok(s.openaiBaseUrl.endsWith(':4000/v1'));
    assert.equal(s.requiresKey, false);
    assert.equal(s.healthy, true);
    // The snapshot advertises SERVED names (aliases when set), with the real ollama
    // tag alongside as `underlying`. Asserting both pins the alias contract — a chat
    // binds to the served name, so it must stay stable while `underlying` changes.
    assert.deepEqual(s.models.map((m) => m.id), servedEntries(c).map((e) => e.servedName));
    assert.deepEqual(s.models.map((m) => m.underlying), c.models.map((m) => m.id));
});

// ---- ollama helpers --------------------------------------------------------
const ollama = require('../src/ollama');

test('normalizeHost adds scheme + default port', () => {
    assert.equal(ollama.normalizeHost('10.0.0.5'), 'http://10.0.0.5:11434');
    assert.equal(ollama.normalizeHost('http://x:9999'), 'http://x:9999');
});

test('hasModel tolerates implicit :latest', () => {
    assert.equal(ollama.hasModel(['gemma4:latest'], 'gemma4'), true);
    assert.equal(ollama.hasModel(['gemma4:12b'], 'gemma4:12b'), true);
    assert.equal(ollama.hasModel(['gemma4:latest'], 'gemma4:12b'), false);
});

// ---- model picker ----------------------------------------------------------
const { parseModelFlag, selectModels } = require('../src/modelPicker');

test('parseModelFlag reads --model / -m / --model= (comma lists)', () => {
    assert.deepEqual(parseModelFlag(['--model', 'gemma4:12b']), ['gemma4:12b']);
    assert.deepEqual(parseModelFlag(['-m', 'a,b,c']), ['a', 'b', 'c']);
    assert.deepEqual(parseModelFlag(['--model=x']), ['x']);
    assert.deepEqual(parseModelFlag(['up']), []);
    assert.deepEqual(parseModelFlag(['--model', '--coordinator']), [], 'a following flag is not the value');
});

test('selectModels: --model wins with no prompt', async () => {
    const got = await selectModels(defaultConfig(), [], ['--model', 'qwen3:8b']);
    assert.deepEqual(got, [{ id: 'qwen3:8b', default: true }]);
});

test('selectModels: --no-pick keeps the config catalog', async () => {
    const c = defaultConfig();
    assert.deepEqual(await selectModels(c, [], ['--no-pick']), c.models);
});

test('selectModels: no reachable models / non-interactive keeps the config catalog', async () => {
    // Empty host list → no installed models → config catalog (never prompts).
    const c = defaultConfig();
    assert.deepEqual(await selectModels(c, [], []), c.models);
});

test('snapshot carries host hardware + usage when provided', () => {
    const c = defaultConfig();
    const s = buildSnapshot(c, {
        proxyUp: true, hostsUp: 1, hostsTotal: 1, loaded: ['gemma4:latest'],
        host: { gpu: 'RTX A6000', vramGb: 48, ramGb: 128, cpuCores: 32 },
        gpu: { gpuUtil: 42, vramUsedGb: 10.5, vramTotalGb: 48 },
    });
    assert.equal(s.host.gpu, 'RTX A6000');
    assert.equal(s.host.vramGb, 48);
    assert.equal(s.usage.gpuUtil, 42);
    assert.equal(s.usage.vramUsedGb, 10.5);
    assert.deepEqual(s.usage.loaded, ['gemma4:latest']);
});

test('snapshot host/usage default to null/empty when absent', () => {
    const s = buildSnapshot(defaultConfig(), { proxyUp: true, hostsUp: 1 });
    assert.equal(s.host, null);
    assert.equal(s.usage.gpuUtil, null);
    assert.deepEqual(s.usage.loaded, []);
});

test('alias mode: snapshot advertises the alias id, stable across model swaps', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;   // this test pins the Ollama alias path
    c.modelAlias = 'assistant';
    c.models = [{ id: 'qwen3.6:35b', default: true }];
    assert.deepEqual(buildSnapshot(c, { proxyUp: true, hostsUp: 1 }).models, [{ id: 'assistant', underlying: 'qwen3.6:35b', default: true }]);
    // switch the underlying model → the advertised alias id stays constant (chats
    // don't break), but `underlying` reflects the real model now running.
    c.models = [{ id: 'gemma4:12b', default: true }];
    assert.deepEqual(buildSnapshot(c, { proxyUp: true, hostsUp: 1 }).models, [{ id: 'assistant', underlying: 'gemma4:12b', default: true }]);
});

test('llamacpp backend: its alias is the ONLY advertised model (one engine at a time)', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = true;   // llamacpp is opt-in since the gemma4-on-Ollama default
    const s = buildSnapshot(c, { proxyUp: true, hostsUp: 1 });
    // Owner decision (2026-08-26): the engines are EXCLUSIVE. Advertising the
    // Ollama catalog alongside read as "both are running", and a client picking an
    // Ollama model while llama-server held ~9 GB of a 12 GB card overcommitted
    // VRAM and crawled. The catalog is standby inventory now — advertised only
    // when the Ollama engine is the one serving.
    assert.equal(s.models.length, 1, 'exactly the llama.cpp alias');
    assert.equal(s.models[0].id, 'assistant');
    assert.equal(s.models[0].default, true);
    assert.equal(s.models[0].underlying, 'Qwen3.8-27B-UD-IQ2_S', 'gguf basename as underlying');

    c.llamacpp.enabled = false;
    const o = buildSnapshot(c, { proxyUp: true, hostsUp: 1 });
    assert.ok(o.models.some((m) => m.id === 'gemma4:12b'), 'Ollama engine advertises the catalog');
});

test('snapshot carries coordinator + deployments (default off)', () => {
    const c = defaultConfig();
    const coord = buildSnapshot(c, { proxyUp: true, hostsUp: 1, coordinator: true, deployments: 4 });
    assert.equal(coord.coordinator, true);
    assert.equal(coord.deployments, 4);
    const plain = buildSnapshot(c, { proxyUp: true, hostsUp: 1 });
    assert.equal(plain.coordinator, false);
    assert.equal(plain.deployments, null);
});

// ---- websearch (SearXNG) -----------------------------------------------------
const { buildSettingsYaml } = require('../src/searxng');

test('websearch config defaults: ON, port 8888', () => {
    const c = defaultConfig();
    assert.equal(c.websearch.enabled, true);   // on by default — a fresh farm gets web search
    assert.equal(c.websearch.port, 8888);
});

test('ollama keepAlive defaults to -1 (keep the model warm)', () => {
    assert.equal(defaultConfig().ollama.keepAlive, '-1');
    // Whole-document chat needs a real context window — Ollama's 4096 default
    // silently truncates a 6-page PDF injected via the client's full-context mode.
    // 'auto' (since farm-v0.0.24): probed per box — the largest num_ctx that stays
    // fully in VRAM, floor 16384 (the measured-safe value 2026-08-21). A number
    // still pins it. See the field comment in config.js.
    assert.equal(defaultConfig().ollama.contextLength, 'auto');
    assert.equal(ConfigSchema.parse({ ollama: { contextLength: 32768 } }).ollama.contextLength, 32768);
    assert.throws(() => ConfigSchema.parse({ ollama: { contextLength: 'max' } }));
});

test('ollama keep_alive reaches the ROUTING as a number — the string "-1" broke every chat', () => {
    // Go's api.Duration: JSON number = seconds (negative = forever), JSON string
    // needs a unit. keep_alive:"-1" made Ollama answer `time: missing unit in
    // duration "-1"` on EVERY completion — the whole Ollama engine was down and
    // nothing here noticed, because the old test only checked the key existed.
    const { keepAliveValue } = require('../src/ollama');
    assert.strictEqual(keepAliveValue('-1'), -1);
    assert.strictEqual(keepAliveValue('0'), 0);
    assert.strictEqual(keepAliveValue('300'), 300);
    assert.strictEqual(keepAliveValue('5m'), '5m', 'real durations pass through');
    const c = defaultConfig();
    c.llamacpp.enabled = false;
    const doc = buildLitellmConfig(c);
    const dep = doc.model_list.find((e) => String(e.litellm_params.model).startsWith('ollama'));
    assert.strictEqual(typeof dep.litellm_params.keep_alive, 'number', 'routing must carry a number');
    assert.strictEqual(dep.litellm_params.keep_alive, -1);
    c.ollama.keepAlive = '5m';
    const dep2 = buildLitellmConfig(c).model_list.find((e) => String(e.litellm_params.model).startsWith('ollama'));
    assert.strictEqual(dep2.litellm_params.keep_alive, '5m');
});

test('ollama auto context: num_ctx floors at 16384 until resolved, then follows the probe', () => {
    const c = defaultConfig();               // ollama.contextLength = 'auto'
    c.llamacpp.enabled = false;
    const dep = () => buildLitellmConfig(c).model_list.find((e) => String(e.litellm_params.model).startsWith('ollama'));
    assert.strictEqual(dep().litellm_params.num_ctx, 16384, 'never ship the string, never ship 4096');
    c.ollama.contextResolved = 65536;        // what resolveOllamaContext probed
    assert.strictEqual(dep().litellm_params.num_ctx, 65536);
});

test('searxng settings.yml has json format + a real secret + limiter off', () => {
    const yml = yaml.load(buildSettingsYaml('a'.repeat(64)));
    assert.equal(yml.use_default_settings, true);
    assert.deepEqual(yml.search.formats.sort(), ['html', 'json'], 'json format is the OWUI-403 gotcha');
    assert.equal(yml.server.secret_key, 'a'.repeat(64));
    assert.notEqual(yml.server.secret_key, 'ultrasecretkey', 'webapp exits on the default key');
    assert.equal(yml.server.limiter, false, 'trusted LAN — no Valkey dependency');
    assert.equal(yml.server.public_instance, false);
    // onion (Tor) engines are disabled so they don't error at boot without a Tor proxy
    const disabled = new Set((yml.engines || []).filter((e) => e.disabled).map((e) => e.name));
    assert.ok(disabled.has('ahmia') && disabled.has('torch'), 'onion engines disabled');
    // Scrape-tolerant engines are ON — with only the stock set, DDG+Startpage+Brave
    // all CAPTCHA'd at once on the live box and search returned one Wikipedia hit.
    const enabled = new Set((yml.engines || []).filter((e) => e.disabled === false).map((e) => e.name));
    for (const e of ['mojeek', 'qwant', 'bing']) assert.ok(enabled.has(e), `${e} must back up the CAPTCHA-prone defaults`);
    assert.match(buildSettingsYaml('a'), /lol-settings v2/, 'version marker drives the upgrade path');
});

test('snapshot advertises searxngUrl only when enabled AND healthy', () => {
    const c = defaultConfig();
    c.websearch.enabled = true;
    const up = buildSnapshot(c, { proxyUp: true, hostsUp: 1, searxngUp: true });
    assert.ok(up.searxngUrl && up.searxngUrl.endsWith(':8888'), `got ${up.searxngUrl}`);
    const down = buildSnapshot(c, { proxyUp: true, hostsUp: 1, searxngUp: false });
    assert.equal(down.searxngUrl, null, 'unhealthy → not advertised');
    c.websearch.enabled = false;
    const off = buildSnapshot(c, { proxyUp: true, hostsUp: 1, searxngUp: true });
    assert.equal(off.searxngUrl, null, 'disabled → not advertised');
});

test('tts config defaults: off, port 8880, voice af_heart, model kokoro', () => {
    const c = defaultConfig();
    assert.equal(c.tts.enabled, false);
    assert.equal(c.tts.port, 8880);
    assert.equal(c.tts.voice, 'af_heart');
    assert.equal(c.tts.model, 'kokoro');
});

test('snapshot advertises ttsUrl/voice/model only when enabled AND healthy', () => {
    const c = defaultConfig();
    c.tts.enabled = true;
    const up = buildSnapshot(c, { proxyUp: true, hostsUp: 1, ttsUp: true });
    assert.ok(up.ttsUrl && up.ttsUrl.endsWith(':8880/v1'), `got ${up.ttsUrl}`);   // /v1 for OWUI base URL
    assert.equal(up.ttsVoice, 'af_heart');
    assert.equal(up.ttsModel, 'kokoro');
    const down = buildSnapshot(c, { proxyUp: true, hostsUp: 1, ttsUp: false });
    assert.equal(down.ttsUrl, null, 'unhealthy → not advertised');
    assert.equal(down.ttsVoice, null);
    c.tts.enabled = false;
    assert.equal(buildSnapshot(c, { proxyUp: true, hostsUp: 1, ttsUp: true }).ttsUrl, null, 'disabled → not advertised');
});

// ---- ocr (document extraction) ---------------------------------------------
const { resolveOcrModel } = require('../src/commands/up');
const { depsSignature } = require('../src/extract');

test('ocr config defaults: ON, port 8890, markdown/auto, preprocess+docling off', () => {
    const c = defaultConfig();
    assert.equal(c.ocr.enabled, true);    // ON by default (owner call 2026-07-05) — document upload is a core workshop flow
    assert.equal(c.ocr.port, 8890);
    assert.equal(c.ocr.format, 'markdown');
    assert.equal(c.ocr.pdfEngine, 'auto');
    assert.equal(c.ocr.preprocess, false);
    assert.equal(c.ocr.docling, false);
    assert.equal(c.ocr.model, undefined); // omitted → auto-picked from served vision model
});

test('ocr rejects a bad format / pdfEngine (strict enum)', () => {
    assert.equal(ConfigSchema.safeParse({ ocr: { format: 'yaml' } }).success, false);
    assert.equal(ConfigSchema.safeParse({ ocr: { pdfEngine: 'ocr' } }).success, false);
});

test('snapshot advertises extract{url,key} only when enabled AND healthy AND keyed', () => {
    const c = defaultConfig();
    c.ocr.enabled = true;
    const up = buildSnapshot(c, { proxyUp: true, hostsUp: 1, extractUp: true, extractKey: 'k123' });
    assert.ok(up.extract && up.extract.url.endsWith(':8890'), `got ${JSON.stringify(up.extract)}`);
    assert.equal(up.extract.key, 'k123');
    assert.ok(!up.extract.url.endsWith('/process'), 'url is the loader BASE — OWUI appends /process');
    const down = buildSnapshot(c, { proxyUp: true, hostsUp: 1, extractUp: false, extractKey: 'k123' });
    assert.equal(down.extract, null, 'unhealthy → not advertised');
    const noKey = buildSnapshot(c, { proxyUp: true, hostsUp: 1, extractUp: true });
    assert.equal(noKey.extract, null, 'no key → not advertised (OWUI loader mandates a key)');
    c.ocr.enabled = false;
    assert.equal(buildSnapshot(c, { proxyUp: true, hostsUp: 1, extractUp: true, extractKey: 'k' }).extract, null, 'disabled → not advertised');
});

test('resolveOcrModel: explicit model wins; else the served default vision model', () => {
    const c = defaultConfig();
    c.ocr.model = 'llama3.2-vision:11b';
    assert.equal(resolveOcrModel(c), 'llama3.2-vision:11b', 'explicit wins');
    delete c.ocr.model;
    c.models = [{ id: 'gemma4:12b', default: true }];
    assert.equal(resolveOcrModel(c), 'gemma4:12b', 'default is vision-capable → used');
    // A text-only default + a vision second → OCR uses the vision one (real Ollama tag).
    c.models = [{ id: 'qwen3:8b', default: true }, { id: 'llava:13b' }];
    assert.equal(resolveOcrModel(c), 'llava:13b');
    // Alias mode: OCR needs the underlying Ollama tag, not the alias clients see.
    c.models = [{ id: 'gemma4:12b', default: true, alias: 'assistant' }];
    assert.equal(resolveOcrModel(c), 'gemma4:12b', 'underlying tag, not the alias');
});

test('extract depsSignature flips with the docling flag (forces reinstall)', () => {
    const off = depsSignature({ ocr: { docling: false } });
    const on = depsSignature({ ocr: { docling: true } });
    assert.notEqual(off, on, 'toggling docling must invalidate the install marker');
});

// ---- admin control API (selfServer) ----------------------------------------
const { startSelfServer } = require('../src/selfServer');

test('admin config default: token null', () => {
    assert.equal(defaultConfig().admin.token, null);
});

test('config rejects unknown admin keys (strict)', () => {
    assert.equal(ConfigSchema.safeParse({ admin: { bogus: 1 } }).success, false);
});

test('selfServer: /lol/self open; admin routes gated by the bearer token', async () => {
    const snap = { v: 1, name: 'T', models: [] };
    const calls = [];
    const control = {
        getAdminState: async () => ({ name: 'T', models: [{ id: 'a', served: true }] }),
        startModel: async (id) => { calls.push(['start', id]); return { ok: true, servedModels: ['a', id] }; },
        stopModel: async (id) => { calls.push(['stop', id]); return { ok: true, servedModels: [] }; },
        setDefaultModel: async (id) => { calls.push(['default', id]); return { ok: true, defaultModel: id }; },
        setContextLength: async (n) => { calls.push(['context', n]); return { ok: true, contextLength: n }; },
        setPlugin: async (id, on) => { calls.push(['plugin', id, on]); return { ok: true, enabled: on }; },
        recommendClientPlugin: (id, on) => { calls.push(['recommend', id, on]); return { ok: true }; },
    };
    const server = startSelfServer({ httpPort: 0, getSnapshot: () => snap, host: '127.0.0.1', control, adminToken: 'secret' });
    await new Promise((r) => { if (server.listening) r(); else server.once('listening', r); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const H = { authorization: 'Bearer secret' };
    try {
        assert.equal((await fetch(`${base}/lol/self`)).status, 200, '/lol/self open');
        assert.equal((await fetch(`${base}/lol/admin`)).status, 200, 'admin page open');
        assert.equal((await fetch(`${base}/lol/admin/state`)).status, 401, 'state needs a token');
        assert.equal((await fetch(`${base}/lol/admin/state`, { headers: { authorization: 'Bearer nope' } })).status, 401, 'wrong token → 401');
        const st = await fetch(`${base}/lol/admin/state`, { headers: H });
        assert.equal(st.status, 200);
        assert.equal((await st.json()).models[0].id, 'a');
        // a mutation without the token must NOT reach control
        assert.equal((await fetch(`${base}/lol/admin/model/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":"x"}' })).status, 401);
        assert.deepEqual(calls, [], 'unauthorized POST never called control');
        const r = await fetch(`${base}/lol/admin/model/start`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: '{"id":"x"}' });
        assert.equal(r.status, 200);
        assert.deepEqual((await r.json()).servedModels, ['a', 'x']);
        assert.deepEqual(calls, [['start', 'x']], 'authorized POST reached control.startModel');
        // plugin toggle + recommend routes: token-gated, and route to the right control fn
        assert.equal((await fetch(`${base}/lol/admin/plugin/ocr/enable`, { method: 'POST' })).status, 401, 'plugin toggle needs a token');
        assert.equal((await (await fetch(`${base}/lol/admin/plugin/ocr/enable`, { method: 'POST', headers: H })).json()).enabled, true);
        assert.equal((await (await fetch(`${base}/lol/admin/plugin/websearch/disable`, { method: 'POST', headers: H })).json()).enabled, false);
        const rc = await fetch(`${base}/lol/admin/plugin/recommend`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: '{"id":"blender","on":true}' });
        assert.equal(rc.status, 200);
        // default-model + context routes: token-gated, route to the right control fn
        assert.equal((await fetch(`${base}/lol/admin/model/default`, { method: 'POST', body: '{"id":"a"}' })).status, 401, 'default needs a token');
        assert.equal((await (await fetch(`${base}/lol/admin/model/default`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: '{"id":"a"}' })).json()).defaultModel, 'a');
        assert.equal((await fetch(`${base}/lol/admin/context`, { method: 'POST', body: '{"tokens":32768}' })).status, 401, 'context needs a token');
        assert.equal((await (await fetch(`${base}/lol/admin/context`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: '{"tokens":32768}' })).json()).contextLength, 32768);
        assert.deepEqual(calls.slice(1), [['plugin', 'ocr', true], ['plugin', 'websearch', false], ['recommend', 'blender', true], ['default', 'a'], ['context', 32768]]);
    } finally {
        server.close();
    }
});

test('selfServer: /lol/client-ping is open, forwards body + remote ip; bad json → 400', async () => {
    const pings = [];
    const server = startSelfServer({
        httpPort: 0, getSnapshot: () => ({}), host: '127.0.0.1',
        control: {}, adminToken: 'secret',
        onClientPing: (body, ip) => { pings.push({ body, ip }); return { ok: true }; },
    });
    await new Promise((r) => { if (server.listening) r(); else server.once('listening', r); });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        // Open route — a desktop client has no admin token.
        const r = await fetch(`${base}/lol/client-ping`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'c1', name: 'desk-01', platform: 'win32', version: '0.1.23', idleSec: 12 }),
        });
        assert.equal(r.status, 200, 'ping is open (no token)');
        assert.equal((await r.json()).ok, true);
        assert.equal(pings.length, 1);
        assert.equal(pings[0].body.id, 'c1');
        assert.equal(pings[0].body.idleSec, 12);
        assert.ok(pings[0].ip.includes('127.0.0.1'), `remote ip captured (got ${pings[0].ip})`);
        // Malformed JSON → 400, handler never called.
        const bad = await fetch(`${base}/lol/client-ping`, { method: 'POST', body: '{nope' });
        assert.equal(bad.status, 400);
        assert.equal(pings.length, 1, 'bad json never reaches onClientPing');
    } finally {
        server.close();
    }
});

test('snapshot usage.clients mirrors clientsConnected (null on older farms)', () => {
    const c = defaultConfig();
    assert.equal(buildSnapshot(c, { proxyUp: true, clientsConnected: 3 }).usage.clients, 3);
    assert.equal(buildSnapshot(c, { proxyUp: true }).usage.clients, null, 'absent → null (old-farm shape)');
});

// ---- plugin registry -------------------------------------------------------
const { makeServices, pluginsSummary, FarmService } = require('../src/plugins/registry');

test('registry: three farm services, config-gated (websearch+ocr on, tts off)', () => {
    const c = defaultConfig();
    const svcs = makeServices();
    assert.deepEqual(svcs.map((s) => s.id), ['websearch', 'tts', 'ocr']);
    assert.equal(svcs.find((s) => s.id === 'websearch').enabled(c), true);
    assert.equal(svcs.find((s) => s.id === 'tts').enabled(c), false);
    assert.equal(svcs.find((s) => s.id === 'ocr').enabled(c), true, 'OCR on by default (owner call)');
    const sum = pluginsSummary(svcs, c);
    assert.equal(sum.websearch.enabled, true);
    assert.equal(sum.websearch.healthy, false, 'not started → not healthy');
    assert.equal(sum.websearch.runsOn, 'farm');
});

test('FarmService: start→up, probe reflects alive, child-exit fires onDown', async () => {
    const { EventEmitter } = require('events');
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 2000000001 });
    let aliveVal = true;
    const desc = {
        id: 'x', label: 'X', logPrefix: 'x', configKey: 'websearch', healthKey: 'searxngUp', runsOn: 'farm',
        enabled: () => true, port: () => 9,
        ensure: async () => true, spawn: () => child,
        waitReady: async () => ({ ok: true, level: 'ok', message: 'up' }),
        alive: async () => aliveVal,
    };
    const log = { step() {}, ok() {}, warn() {}, err() {}, childPrefix: () => () => {} };
    const svc = new FarmService(desc);
    const res = await svc.start(defaultConfig(), { log });
    assert.equal(res.ok, true);
    assert.equal(svc.up, true);
    assert.equal(svc.pid, 2000000001);
    assert.equal(await svc.probe(defaultConfig()), true, 'alive → up');
    aliveVal = false;
    assert.equal(await svc.probe(defaultConfig()), false, 'not answering → not up');
    aliveVal = true; svc.up = true; svc.wasUp = true;   // re-up for the exit test
    let downFired = false;
    svc.onDown = () => { downFired = true; };
    child.emit('exit', 0);
    assert.equal(svc.up, false, 'child exit clears up');
    assert.equal(svc.pid, null, 'child cleared');
    assert.equal(downFired, true, 'onDown fired on a running child exit');
});

test('recommendedClientPlugins default is empty; snapshot advertises plugins + recommendations', () => {
    assert.deepEqual(defaultConfig().recommendedClientPlugins, []);
    const c = defaultConfig();
    c.recommendedClientPlugins = ['blender'];
    const s = buildSnapshot(c, { proxyUp: true, hostsUp: 1, plugins: { websearch: { enabled: true, healthy: true } } });
    assert.deepEqual(s.recommendedClientPlugins, ['blender']);
    assert.equal(s.plugins.websearch.healthy, true);
    const s2 = buildSnapshot(defaultConfig(), { proxyUp: true, hostsUp: 1 });
    assert.deepEqual(s2.plugins, {}, 'no plugins → empty map');
    assert.deepEqual(s2.recommendedClientPlugins, []);
});

// ---- systemInfo ------------------------------------------------------------
const { detectHardware, gpuLiveStats } = require('../src/systemInfo');

test('detectHardware reports RAM + CPU cores (GPU may be Unknown without nvidia-smi)', async () => {
    const hw = await detectHardware();
    assert.ok(hw.ramGb > 0, 'ramGb > 0');
    assert.ok(hw.cpuCores > 0, 'cpuCores > 0');
    assert.equal(typeof hw.gpu, 'string');
});

test('gpuLiveStats returns the expected shape (nulls if no nvidia-smi)', async () => {
    const g = await gpuLiveStats();
    for (const k of ['gpuUtil', 'vramUsedGb', 'vramTotalGb']) assert.ok(k in g, k);
});

// ---- net -------------------------------------------------------------------
const { broadcastAddr } = require('../src/net');

test('broadcastAddr honors the netmask (/23 → .17.255)', () => {
    assert.equal(broadcastAddr('10.10.16.58', '255.255.254.0'), '10.10.17.255');
    assert.equal(broadcastAddr('192.168.1.20', '255.255.255.0'), '192.168.1.255');
});

// ---- preinstall: installed but NOT served ----------------------------------
// The invariant: a client must never be able to change what the farm is running.
// Anything in `models` is a LiteLLM deployment and is advertised, so a client can
// select it — and on a single-GPU box that EVICTS whatever was loaded. Heavy models
// therefore live in `preinstall`: on disk, startable by the farm admin, invisible to
// clients until the admin serves them.
test('preinstall models are pulled but never served or advertised', () => {
    const c = defaultConfig();
    assert.ok(c.preinstall.length >= 1, 'a heavy model is preinstalled by default');
    const hidden = c.preinstall[0];

    const deployed = buildLitellmConfig(c).model_list.map((d) => d.model_name);
    assert.ok(!deployed.includes(hidden.id), 'no LiteLLM deployment for a preinstalled model');
    assert.ok(!deployed.includes(hidden.alias), 'not reachable via its alias either');

    const snap = buildSnapshot(c, { proxyUp: true, hostsUp: 1, hostsTotal: 1 });
    const advertised = snap.models.flatMap((m) => [m.id, m.underlying]);
    assert.ok(!advertised.includes(hidden.id), 'absent from the discovery snapshot');
});

test('the default farm serves exactly one model', () => {
    // One GPU, one served model: a second entry here is a second thing any client
    // could load, which is the farm admin's decision to make explicitly.
    const c = defaultConfig();
    assert.equal(c.models.length, 1);
    assert.equal(c.models[0].id, 'gemma4:12b');
    assert.equal(c.models[0].default, true);
});

test('a preinstalled model keeps its alias when the admin starts it', () => {
    // startModel() merges the preinstall definition rather than pushing a bare { id },
    // so a chat binds to the stable role name and survives a later re-quantisation.
    const c = defaultConfig();
    const hidden = c.preinstall[0];
    assert.equal(hidden.alias, 'reasoning');
    const started = Object.assign({}, c);
    started.models = c.models.concat([{ ...hidden }]);
    const names = servedEntries(started).map((e) => e.servedName);
    assert.ok(names.includes('reasoning'), 'served under its alias, not the quant-specific id');
    assert.ok(!names.includes(hidden.id), 'the raw derived id is not what clients bind to');
});

test('the preinstalled quant carries a separate draft/MTP module', () => {
    // Unsloth strips the built-in MTP head from every quant under UD-Q2_K_XL to save
    // ~500MB, so UD-IQ2_XXS has ZERO nextn tensors and `draft_num_predict` alone is
    // inert. The separate module is what makes speculative decoding work at all here.
    const c = defaultConfig();
    const m = c.preinstall[0];
    assert.ok(m.draft, 'a draft module URL is configured');
    assert.match(m.draft, /^https:\/\//, 'fetched over https, not an ollama pull');
    assert.match(m.draft, /mtp-.*\.gguf$/i);
    assert.equal(m.params.draft_num_predict, 4, 'and the parameter that drives it');
});

test('draft modules cache to a stable, gitignored path', () => {
    // Stable so a second install is a no-op rather than a re-download. Compared via
    // path parts rather than a regex so it holds on both Windows and POSIX.
    const path = require('path');
    const url = 'https://example.com/x/MTP/mtp-Qwen3.8-27B-Q4_0.gguf';
    assert.equal(ollama.draftPathFor(url), ollama.draftPathFor(url), 'deterministic');
    assert.equal(path.basename(ollama.draftPathFor(url)), 'mtp-Qwen3.8-27B-Q4_0.gguf');
    assert.equal(path.basename(path.dirname(ollama.draftPathFor(url))), '.models');
});

// ---- llama.cpp backend ------------------------------------------------------
const llamacpp = require('../src/llamacpp');

test('gemma4:12b on Ollama is the DEFAULT engine in this build', () => {
    // Owner decision (2026-08-27): gemma4's sliding-window attention holds its
    // native 262144 context in ~10 GB (probed live), where the llama.cpp Qwen
    // setup caps at ~36k on a 4070 — and max context is what thinking models +
    // whole-document RAG need. llama.cpp stays one panel click away.
    const c = defaultConfig();
    assert.equal(c.llamacpp.enabled, false, 'llama.cpp is opt-in now');
    assert.equal(c.models[0].id, 'gemma4:12b');
    assert.equal(c.ollama.contextLength, 'auto', 'context is probed per box');
    const deployed = buildLitellmConfig(c).model_list;
    assert.equal(deployed.length, 1, 'one engine at a time — the Ollama deployment');
    assert.ok(deployed[0].litellm_params.model.startsWith('ollama'), 'served by Ollama');
    assert.ok(deployed[0].model_info && deployed[0].model_info.supports_vision,
        'gemma4 is vision-native — images work out of the box');
});

test('llamacpp engine: NO local Ollama deployments at all — peers still aggregate', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = true;
    c.models = [{ id: 'gemma4:12b', default: true }, { id: 'qwen2.5-coder:7b' }];
    const doc = buildLitellmConfig(c);
    assert.equal(doc.model_list.length, 1, 'one engine at a time');
    assert.equal(doc.model_list[0].model_name, c.llamacpp.alias);
    assert.ok(doc.model_list[0].litellm_params.model.startsWith('openai/'), 'llama-server speaks OpenAI');
    // A coordinator in llama.cpp mode still fronts its PEERS — exclusivity is
    // about this box's two local engines, not about the fleet.
    const peers = [{ openaiBaseUrl: 'http://10.0.0.9:4000/v1', models: ['assistant'] }];
    const withPeers = buildLitellmConfig(c, peers);
    assert.ok(withPeers.model_list.some((d) => d.litellm_params.api_base === 'http://10.0.0.9:4000/v1'), 'peer deployment present');
});

test('llama-server argv carries the measured recipe', () => {
    const c = defaultConfig();
    const a = llamacpp.argsFor(c, 'M.gguf', 'P.gguf').join(' ');
    // Default quant is UD-IQ2_S, whose MTP head Unsloth STRIPS — draft-mtp on it
    // makes llama-server exit ("model doesn't contain MTP layers"), so the default
    // argv must NOT carry it.
    assert.ok(!a.includes('draft-mtp'), 'mtp stays off for a stripped-head quant');
    assert.match(a, /--cache-type-k q4_0 --cache-type-v q4_0/);
    assert.match(a, /-fa 1/);
    assert.match(a, /--n-gpu-layers 999/);
    assert.match(a, /--mmproj P\.gguf/);
    // MTP stays available as an opt-in for UD-Q2_K_XL-and-above quants.
    c.llamacpp.mtp = true;
    assert.match(llamacpp.argsFor(c, 'M.gguf', null).join(' '), /--spec-type draft-mtp/);
});

test('llamacpp knobs can be turned off individually', () => {
    const c = defaultConfig();
    c.llamacpp.mtp = false;
    c.llamacpp.kvCacheType = 'f16';
    c.llamacpp.flashAttention = false;
    const a = llamacpp.argsFor(c, 'M.gguf', null).join(' ');
    assert.ok(!a.includes('draft-mtp'));
    assert.ok(!a.includes('--cache-type-k'), 'f16 means no KV quantization flags');
    assert.ok(!a.includes('-fa 1'));
    assert.ok(!a.includes('--mmproj'));
});


// ---- backend visibility + capacity -----------------------------------------
const { backendInfo, ggufName } = require('../src/snapshot');

test('snapshot advertises WHICH engine serves, and on what weights', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = true;
    const snap = buildSnapshot(c, { clientsConnected: 1 });
    assert.equal(snap.backend.engine, 'llama.cpp');
    assert.equal(snap.backend.alias, c.llamacpp.alias);
    assert.equal(snap.backend.model, 'Qwen3.8-27B-UD-IQ2_S', 'the .gguf basename, not the alias');

    c.llamacpp.enabled = false;
    const oll = buildSnapshot(c, { hostsUp: 1 });
    assert.equal(oll.backend.engine, 'ollama');
    assert.equal(oll.backend.model, c.models[0].id);
});

test('llama.cpp SPLITS its context across slots; Ollama does not', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = true;
    c.llamacpp.contextLength = 16384;
    c.llamacpp.parallel = 2;
    const be = backendInfo(c, {});
    assert.equal(be.slots, 2);
    assert.equal(be.contextPerSlot, 8192, '--ctx-size 16384 --parallel 2 -> n_ctx_slot 8192');

    c.llamacpp.enabled = false;
    c.ollama.numParallel = 2;
    c.ollama.contextLength = 24576;          // pinned
    const o = backendInfo(c, { hostsUp: 3 });
    assert.equal(o.slots, 6, 'numParallel x reachable hosts');
    assert.equal(o.contextPerSlot, 24576, 'every Ollama request keeps the full window');
    assert.equal(o.contextAuto, false);

    // 'auto' (the default) must never leak the string: null until the probe
    // resolves it, then the resolved number — flagged so clients/panel can say so.
    c.ollama.contextLength = 'auto';
    const unresolved = backendInfo(c, { hostsUp: 3 });
    assert.strictEqual(unresolved.contextLength, null);
    assert.strictEqual(unresolved.contextPerSlot, null);
    assert.equal(unresolved.contextAuto, true);
    c.ollama.contextResolved = 65536;
    assert.equal(backendInfo(c, { hostsUp: 3 }).contextPerSlot, 65536);
});

test('capacity is advisory: slots + who is on the box right now', () => {
    const c = defaultConfig();
    c.llamacpp.parallel = 2;
    const snap = buildSnapshot(c, { clientsConnected: 3 });
    assert.equal(snap.capacity.slots, 2);
    assert.equal(snap.capacity.clients, 3, 'over-capacity is reported, never refused');
    assert.equal(snap.capacity.busy, null, 'no engine metrics yet → busy unknown, not 0');
    // A farm with no client-ping support must not invent a client count.
    assert.equal(buildSnapshot(c, {}).capacity.clients, 0);
});

test('ggufName survives a non-URL model path', () => {
    assert.equal(ggufName('https://h.co/r/resolve/main/Qwen3.8-27B-UD-IQ2_S.gguf'), 'Qwen3.8-27B-UD-IQ2_S');
    assert.equal(ggufName('/local/path/model.gguf'), 'llama.cpp');
    assert.equal(ggufName(null), 'llama.cpp');
});

// ---- the model library ------------------------------------------------------
test('llamacpp.library ships the measured quants, and the active model is one of them', () => {
    const c = defaultConfig();
    const lib = c.llamacpp.library;
    assert.ok(lib.length >= 3, 'a library to choose from');
    assert.ok(lib.every((e) => e.id && e.label && e.url), 'every entry is selectable + readable');
    assert.ok(lib.some((e) => e.url === c.llamacpp.model), 'the served model appears in the library');
    // The MTP flag is what stops llama-server refusing to boot on a stripped quant.
    const active = lib.find((e) => e.url === c.llamacpp.model);
    assert.equal(active.mtp, false);
    assert.equal(c.llamacpp.mtp, false, 'the default quant has no MTP head, so MTP is off');
});

test('a library entry can be added by URL alone (strict schema, sane defaults)', () => {
    const r = ConfigSchema.safeParse({
        llamacpp: { library: [{ id: 'x', label: 'X', url: 'https://h.co/x.gguf' }] },
    });
    assert.equal(r.success, true);
    const e = r.data.llamacpp.library[0];
    assert.equal(e.mmproj, null);
    assert.equal(e.sizeGb, null);
    assert.equal(e.mtp, false, 'unknown quants are assumed MTP-less — the safe direction');
});

// ---- persisting panel changes ----------------------------------------------
const { patchSection, patchConfigFile, readRawConfig } = require('../src/configFile');

test('patchSection edits one section and leaves the rest of the file alone', () => {
    const f = path.join(os.tmpdir(), `lol-cfgtest-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify({ name: 'Mine', ollama: { hosts: ['http://a:11434'] }, custom: 42 }));
    try {
        assert.equal(patchSection(f, 'llamacpp', { alias: 'studio' }).ok, true);
        const raw = readRawConfig(f);
        assert.equal(raw.llamacpp.alias, 'studio');
        assert.equal(raw.custom, 42, 'unknown keys survive');
        assert.deepEqual(raw.ollama.hosts, ['http://a:11434'], 'other sections untouched');
        // It must NOT materialize schema defaults into the operator's file — that would
        // freeze today's defaults and opt them out of tomorrow's.
        assert.equal('models' in raw, false);
        assert.equal('parallel' in raw.llamacpp, false);
        // undefined deletes, which is how "back to the farm default" is expressed.
        patchSection(f, 'llamacpp', { alias: undefined });
        assert.equal('alias' in readRawConfig(f).llamacpp, false);
    } finally { fs.unlinkSync(f); }
});

test('a patch of a missing/unreadable config fails softly (never throws)', () => {
    const missing = path.join(os.tmpdir(), `lol-nope-${process.pid}.json`);
    assert.equal(patchSection(missing, 'llamacpp', { alias: 'x' }).ok, false);
    assert.equal(patchConfigFile(null, (r) => r).ok, false);
});

// ---- the admin routes the panel drives -------------------------------------
test('selfServer routes every backend/model control, all behind the token', async () => {
    const calls = [];
    const rec = (k) => (...a) => { calls.push([k, ...a]); return { ok: true }; };
    const control = {
        getAdminState: async () => ({}),
        setBackend: rec('backend'),
        setAdvertisedName: rec('name'),
        setSlots: rec('slots'),
        setLlamacppModel: rec('lcmodel'),
        addLibraryModel: rec('libadd'),
        removeLibraryModel: rec('librm'),
        pullOllamaModel: rec('pull'),
        removeOllamaModel: rec('olrm'),
        setModelAlias: rec('malias'),
        applyFarmSettings: rec('apply'),
    };
    const server = startSelfServer({ httpPort: 0, getSnapshot: () => ({}), host: '127.0.0.1', control, adminToken: 'secret' });
    await new Promise((r) => { if (server.listening) r(); else server.once('listening', r); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (p, body, tok = 'secret') => fetch(base + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
        body: JSON.stringify(body),
    });
    try {
        // Every mutation must be gated — these change what the whole LAN is served.
        assert.equal((await post('/lol/admin/backend', { engine: 'ollama' }, 'nope')).status, 401);
        assert.equal(calls.length, 0, 'an unauthorized call must not reach control');

        assert.equal((await post('/lol/admin/backend', { engine: 'ollama' })).status, 200);
        await post('/lol/admin/name', { name: 'Studio' });
        await post('/lol/admin/slots', { slots: 4 });
        await post('/lol/admin/llamacpp/model', { id: 'q' });
        await post('/lol/admin/llamacpp/library/add', { url: 'https://h.co/x.gguf' });
        await post('/lol/admin/llamacpp/library/remove', { id: 'q' });
        await post('/lol/admin/ollama/pull', { id: 'gemma4:12b' });
        await post('/lol/admin/ollama/remove', { id: 'gemma4:12b' });
        await post('/lol/admin/model/alias', { id: 'gemma4:12b', alias: 'tutor' });
        await post('/lol/admin/apply', { name: 'Studio', slots: 2, context: 'auto' });

        assert.deepEqual(calls.map((c) => c[0]),
            ['backend', 'name', 'slots', 'lcmodel', 'libadd', 'librm', 'pull', 'olrm', 'malias', 'apply']);
        assert.deepEqual(calls[9][1], { name: 'Studio', slots: 2, context: 'auto' }, 'the whole change set reaches applyFarmSettings');
        assert.equal(calls[0][1], 'ollama');
        assert.equal(calls[1][1], 'Studio');
        assert.equal(calls[2][1], 4);
        assert.equal(calls[3][1].id, 'q', 'the whole body reaches setLlamacppModel (id OR url)');
        assert.equal(calls[6][1], 'gemma4:12b');
        assert.deepEqual(calls[8].slice(1), ['gemma4:12b', 'tutor'], 'id + alias reach setModelAlias');
    } finally { server.close(); }
});

test('per-model alias outranks the global modelAlias; unnamed models keep their checkpoint id', () => {
    // Owner call 2026-08-28: every downloaded model defaults to its checkpoint
    // name; the admin can override each one (the panel's per-model Rename).
    const c = defaultConfig();
    c.llamacpp.enabled = false;
    c.models = [{ id: 'gemma4:12b', default: true }, { id: 'qwen2.5-coder:14b' }];
    c.modelAlias = 'assistant';
    let names = servedEntries(c).map((e) => e.servedName);
    assert.deepEqual(names, ['assistant', 'qwen2.5-coder:14b'], 'global alias names the default; the rest keep their id');
    c.models[0].alias = 'tutor';                       // per-model rename of the default
    c.models[1].alias = 'coder';
    names = servedEntries(c).map((e) => e.servedName);
    assert.deepEqual(names, ['tutor', 'coder'], 'a per-model alias wins over the global one');
});

test('sharded GGUF: any part URL resolves to the full set; weights sum ALL shards', () => {
    const lc = require('../src/llamacpp');
    const os = require('os');
    const pathMod = require('path');
    const base = 'https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF/resolve/main/UD-IQ1_S/Qwen3.8-Flash-Next-UD-IQ1_S';
    // Pasting part 2 (or 3) must still yield shard 1 as the entry point + all siblings.
    const parts = lc.shardUrls(base + '-00002-of-00003.gguf');
    assert.equal(parts.length, 3);
    assert.ok(parts[0].endsWith('-00001-of-00003.gguf'));
    assert.ok(parts[2].endsWith('-00003-of-00003.gguf'));
    assert.equal(lc.normalizeModelUrl(base + '-00003-of-00003.gguf'), parts[0]);
    // Single files pass through untouched.
    assert.equal(lc.shardUrls('https://x/y/model.gguf'), null);
    assert.equal(lc.normalizeModelUrl('https://x/y/model.gguf'), 'https://x/y/model.gguf');

    // The VRAM budget must see the SUM of the shards — shard 1 of a split model
    // can be a few MB of metadata while the tensors live in its siblings.
    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'lol-shards-'));
    const mk = (name, bytes) => fs.writeFileSync(pathMod.join(dir, name), Buffer.alloc(bytes));
    mk('m-00001-of-00003.gguf', 10);
    mk('m-00002-of-00003.gguf', 5000);
    mk('m-00003-of-00003.gguf', 2000);
    assert.equal(lc.weightsBytesFor(pathMod.join(dir, 'm-00001-of-00003.gguf')), 7010);
    mk('single.gguf', 123);
    assert.equal(lc.weightsBytesFor(pathMod.join(dir, 'single.gguf')), 123);
    fs.rmSync(dir, { recursive: true, force: true });

    // The advertised name drops the shard index (cosmetic, but it IS the label).
    assert.equal(ggufName(base + '-00001-of-00003.gguf'), 'Qwen3.8-Flash-Next-UD-IQ1_S');
});

// ---- switching feedback + performance + fit (2026-08-26) --------------------
const perfMod = require('../src/perf');

test('snapshot carries the in-flight admin job as `busy` (live thunk, active only)', () => {
    const c = defaultConfig();
    const job = { kind: 'model', label: 'Loading X', message: 'downloading', percent: 40, done: false };
    const s1 = buildSnapshot(c, { getJob: () => ({ kind: job.kind, label: job.label, message: job.message, percent: job.percent }) });
    assert.equal(s1.busy.label, 'Loading X');
    assert.equal(s1.busy.percent, 40);
    const s2 = buildSnapshot(c, { getJob: () => null });
    assert.equal(s2.busy, null, 'no job → busy null');
    const s3 = buildSnapshot(c, {});
    assert.equal(s3.busy, null, 'older farms without the thunk stay well-formed');
});

test('perf: prometheus parse + true tok/s while generating (not wall-clock)', () => {
    const text = [
        '# HELP llamacpp:tokens_predicted_total x',
        'llamacpp:tokens_predicted_total 1000',
        'llamacpp:tokens_predicted_seconds_total 10',
        'llamacpp:prompt_tokens_total 400',
        'llamacpp:prompt_seconds_total 2',
        'llamacpp:requests_processing 1',
        'llamacpp:requests_deferred 2',
        'llamacpp:kv_cache_usage_ratio 0.25',
    ].join('\n');
    const m = perfMod.parsePrometheus(text);
    assert.equal(m['llamacpp:tokens_predicted_total'], 1000);
    const prev = perfMod.metricsSample(m, 0);
    // 60 s of wall clock later, but only 2 s were spent generating 100 tokens:
    // the honest rate is 50 tok/s, not 100/60.
    const m2 = { ...m, 'llamacpp:tokens_predicted_total': 1100, 'llamacpp:tokens_predicted_seconds_total': 12 };
    const cur = perfMod.metricsSample(m2, 60000);
    const r = perfMod.sampleRates(prev, cur);
    assert.equal(r.genTokSec, 50);
    assert.equal(prev.queued, 2);
    // A restarted llama-server resets its counters — the stale baseline must be
    // flagged, not reported as a huge negative rate.
    const r2 = perfMod.sampleRates(cur, perfMod.metricsSample({ 'llamacpp:tokens_predicted_total': 5, 'llamacpp:tokens_predicted_seconds_total': 1 }, 70000));
    assert.equal(r2.reset, true);
});

test('fitBudget: refuses the exact shape that took AN-VR-01 down', () => {
    // The live incident: 256k context saved from the panel onto a 12 GB card.
    // llama-server "worked" (Windows overcommits) at a few tok/s.
    const bad = perfMod.fitBudget({ vramGb: 12, weightsGb: 6.9, mmprojGb: 0.8, kvCacheType: 'q4_0', contextLength: 262144 });
    assert.equal(bad.fits, false);
    assert.ok(bad.needGb > 20, '256k of q4_0 KV is ~19 GB on its own');
    assert.ok(bad.maxContext >= 16384 && bad.maxContext < 65536, 'a sane ceiling for 12 GB');
    const ok = perfMod.fitBudget({ vramGb: 12, weightsGb: 6.9, mmprojGb: 0.8, kvCacheType: 'q4_0', contextLength: 16384 });
    assert.equal(ok.fits, true, 'the shipped default fits the fleet card');
    // Unknown VRAM (unified memory, no nvidia-smi) → NO verdict, never a refusal.
    const unknown = perfMod.fitBudget({ vramGb: 0, weightsGb: 6.9, contextLength: 262144 });
    assert.equal(unknown.fits, null);
    assert.equal(unknown.maxContext, null);
});

test('shouldEvictOllama: only under pressure, only when idle, only llama.cpp engine', () => {
    const base = { llamacppOn: true, vramUsedGb: 11.5, vramTotalGb: 12, gpuUtil: 3, loadedCount: 1 };
    assert.equal(perfMod.shouldEvictOllama(base), true, 'full + idle + loaded → evict');
    assert.equal(perfMod.shouldEvictOllama({ ...base, gpuUtil: 80 }), false, 'never mid-generation/extraction');
    assert.equal(perfMod.shouldEvictOllama({ ...base, vramUsedGb: 8 }), false, 'no pressure → leave it warm');
    assert.equal(perfMod.shouldEvictOllama({ ...base, llamacppOn: false }), false, 'Ollama engine keeps its own models');
    assert.equal(perfMod.shouldEvictOllama({ ...base, loadedCount: 0 }), false);
    assert.equal(perfMod.shouldEvictOllama({ ...base, vramTotalGb: 0 }), false, 'unknown VRAM → hands off');
});

test('llama-server argv exposes /metrics for the performance monitor', () => {
    const c = defaultConfig();
    assert.ok(llamacpp.argsFor(c, 'M.gguf', null).includes('--metrics'));
});

test('KV cache defaults: Ollama q8_0 (flash-attention gated), llama.cpp RAM cache auto-sized', () => {
    const c = defaultConfig();
    assert.equal(c.ollama.kvCacheType, 'q8_0', 'quantized KV = twice the context in the same VRAM, on by default');
    assert.equal(c.llamacpp.cacheRam, 'auto');
    assert.equal(ConfigSchema.safeParse({ ollama: { kvCacheType: 'q5_1' } }).success, false, 'only f16/q8_0/q4_0 are valid');
    // argv: auto sizes from system RAM within [8192, 32768]; explicit values pass through.
    const args = llamacpp.argsFor(c, 'M.gguf', null);
    const i = args.indexOf('--cache-ram');
    assert.ok(i >= 0, 'RAM prompt cache must be sized explicitly');
    const mib = parseInt(args[i + 1], 10);
    assert.ok(mib >= 8192 && mib <= 32768, `auto cache-ram out of range: ${mib}`);
    c.llamacpp.cacheRam = 0;
    const off = llamacpp.argsFor(c, 'M.gguf', null);
    assert.equal(off[off.indexOf('--cache-ram') + 1], '0', 'cacheRam 0 must disable, not fall back to auto');
});

test('virtual interfaces never reach the beacon or the advertised addresses', () => {
    // Live 2026-09-03: Docker's compose bridge (br-<hash>, 172.22.0.1) got
    // beaconed on, and the client on the same box flapped its farm endpoint
    // between the bridge and the real LAN IP — restarting its engine forever.
    const { isVirtualIfaceName } = require('../src/net');
    for (const bad of ['docker0', 'br-1a2bc3d4', 'veth1ab', 'virbr0', 'vmnet8', 'vboxnet0', 'tailscale0', 'wg0', 'vEthernet (WSL)', 'podman1']) {
        assert.ok(isVirtualIfaceName(bad), `${bad} must be filtered`);
    }
    for (const good of ['eno1', 'eth0', 'wlan0', 'en0', 'Ethernet', 'Wi-Fi', 'br0', 'bridge0']) {
        assert.ok(!isVirtualIfaceName(good), `${good} is a real NIC (plain br0 is a server bridge, not compose's br-<hex>)`);
    }
});

test('panel context dropdown adapts to the model: 1M offers 1M, 32k stops at 32k', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
    const start = html.indexOf('function ctxOptions');
    const end = html.indexOf('function bindApply');
    assert.ok(start > 0 && end > start, 'panel source moved — update the extraction anchors');
    const ctx = { out: null };
    // eslint-disable-next-line no-new-func
    new Function('ctx', html.slice(start, end) + '; ctx.out = { ctxOptions, fmtK };')(ctx);
    const { ctxOptions, fmtK } = ctx.out;
    const values = (s) => [...s.matchAll(/value="(\d+)"/g)].map((m) => parseInt(m[1], 10));

    // 1M-native model (the live nemotron ask): doubled steps + the max itself.
    const big = ctxOptions('auto', 262144, null, 1048576);
    const bv = values(big);
    assert.ok(bv.includes(524288) && bv.includes(1048576), `1M model must offer 512k and 1M, got ${bv}`);
    assert.ok(big.includes('everything this model can read'), 'the model-max option says what it is');
    assert.ok(big.includes('1M tokens'), 'fmtK renders 1M, not 1024k');

    // Small-native model: never offer windows it cannot read.
    const small = values(ctxOptions('auto', 16384, null, 32768));
    assert.equal(Math.max(...small), 32768, `32k model must stop at 32k, got ${small}`);

    // Native unknown (probe pending): the base list, top 262144.
    const base = values(ctxOptions('auto', null, null, null));
    assert.equal(Math.max(...base), 262144);

    // VRAM advisories still ride along: options past fit.maxContext are flagged, not dropped.
    const flagged = ctxOptions('auto', null, { maxContext: 65536, vramGb: 12 }, 1048576);
    assert.ok(/data-over="1"[^>]*>131072|value="131072"[^>]*data-over="1"/.test(flagged.replace(/\n/g, '')), 'oversized options carry the advisory flag');
    assert.ok(!flagged.includes('disabled'), 'advisory, never disabled');
    assert.equal(fmtK(524288), '512k');
});

test('unified KV pool + strict slot routing ride the argv (verified live 2026-09-03)', () => {
    const c = defaultConfig();
    const args = llamacpp.argsFor(c, 'M.gguf', null);
    assert.ok(args.includes('--kv-unified'), 'solo user must get the FULL window (n_ctx_slot = ctx, measured)');
    const i = args.indexOf('--slot-prompt-similarity');
    assert.ok(i >= 0 && args[i + 1] === '0.4', 'upstream default 0.1 routes chats onto barely-matching caches');
    c.llamacpp.kvUnified = false;
    assert.ok(!llamacpp.argsFor(c, 'M.gguf', null).includes('--kv-unified'), 'kvUnified:false restores the hard split');
});

test('cacheHitRatio: cached vs processed prompt tokens between two samples', () => {
    const { metricsSample, sampleRates } = require('../src/perf');
    const mk = (pred, predSec, prompt, cached) => metricsSample({
        'llamacpp:tokens_predicted_total': pred, 'llamacpp:tokens_predicted_seconds_total': predSec,
        'llamacpp:prompt_tokens_total': prompt, 'llamacpp:prompt_seconds_total': predSec,
        'llamacpp:prompt_tokens_cached_total': cached,
    }, Date.now());
    // The live measurement: repeated 3182-token prompt → processed 518, cached 2666.
    const r = sampleRates(mk(100, 10, 3182, 0), mk(140, 12, 3700, 2666));
    assert.equal(r.cacheHitRatio, 0.84, `84% of the window's prompt tokens came from cache, got ${r.cacheHitRatio}`);
    // No prompt traffic in the window → null, never NaN or 0-pretending-to-be-data.
    const idle = sampleRates(mk(100, 10, 3182, 500), mk(120, 11, 3182, 500));
    assert.equal(idle.cacheHitRatio, null);
    // Old builds without the counter → null (kvUsed already handles absence the same way).
    const old = sampleRates(
        metricsSample({ 'llamacpp:tokens_predicted_total': 1, 'llamacpp:tokens_predicted_seconds_total': 1, 'llamacpp:prompt_tokens_total': 10 }, 1),
        metricsSample({ 'llamacpp:tokens_predicted_total': 2, 'llamacpp:tokens_predicted_seconds_total': 2, 'llamacpp:prompt_tokens_total': 30 }, 2));
    assert.equal(old.cacheHitRatio, null);
});

test('KV cache-reuse rides the argv — except under MTP, which conflicts', () => {
    const c = defaultConfig();
    const args = llamacpp.argsFor(c, 'M.gguf', null);
    const i = args.indexOf('--cache-reuse');
    assert.ok(i >= 0 && args[i + 1] === '256', 'follow-up turns must not reprocess the whole history');
    c.llamacpp.mtp = true;
    assert.ok(!llamacpp.argsFor(c, 'M.gguf', null).includes('--cache-reuse'), 'speculative decoding conflicts with cache shifting');
});

test('llamacpp.supported() answers whether a prebuilt exists for THIS platform', () => {
    const expect = process.platform === 'win32' && process.arch === 'x64';
    assert.equal(llamacpp.supported(), expect, 'only win-x64 has an auto-fetchable build today — everything else must fall back to Ollama, not die');
});

test('engine failure explains the REAL error, not a canned MTP guess', () => {
    // The live 2026-08-28 case: a too-new architecture, MTP off — the old message
    // blamed MTP anyway.
    const qwen = llamacpp.explainEngineFailure([
        "0.00.291.396 E llama_model_load: error loading model: unknown model architecture: 'qwen4exp'",
        '0.00.291.403 E llama_model_load_from_file_impl: failed to load model',
    ]);
    assert.ok(qwen.includes("'qwen4exp'"), 'names the unknown architecture');
    assert.ok(qwen.includes(llamacpp.PINNED_BUILD), 'names the build that is too old');
    assert.ok(!/MTP/.test(qwen), 'does not blame MTP for an architecture problem');
    // The MTP case still gets its targeted explanation.
    const mtp = llamacpp.explainEngineFailure(["E model doesn't contain MTP layers"]);
    assert.ok(/MTP/.test(mtp) && /turn MTP off/.test(mtp));
    // Unrecognized errors are quoted verbatim instead of guessed at.
    const other = llamacpp.explainEngineFailure(['I srv init: fine', 'E cuda: out of memory']);
    assert.ok(other.includes('out of memory'));
    // Nothing captured (instant spawn failure) still yields a pointer, not a guess.
    assert.ok(/farm log/.test(llamacpp.explainEngineFailure([])));
});


// ---- audit-driven regression tests (iteration 1, 2026-08-26) -----------------

test('extract() really extracts — the zipPath regression shipped because nothing ran it', () => {
    // Windows-only smoke (the fleet's platform): a real zip through the real code.
    if (process.platform !== 'win32') return;
    const { execFileSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-extract-'));
    fs.writeFileSync(path.join(tmp, 'hello.txt'), 'hi');
    const zip = path.join(tmp, 'a.zip');
    execFileSync('powershell', ['-NoProfile', '-Command',
        `Compress-Archive -Path '${path.join(tmp, 'hello.txt')}' -DestinationPath '${zip}'`]);
    const dest = path.join(tmp, 'out');
    llamacpp.extract(zip, dest);
    assert.ok(fs.existsSync(path.join(dest, 'hello.txt')), 'zip extracted');
    fs.rmSync(tmp, { recursive: true, force: true });
});

test('a dead ENGINE makes the farm unhealthy (clients must fail over)', () => {
    const c = defaultConfig();
    assert.equal(buildSnapshot(c, { proxyUp: true, hostsUp: 1, engineUp: true }).healthy, true);
    assert.equal(buildSnapshot(c, { proxyUp: true, hostsUp: 1, engineUp: false }).healthy, false,
        'llama-server died → unhealthy, even with proxy + Ollama hosts up');
    // Old farms / Ollama engine never set engineUp — absence must not read as dead.
    assert.equal(buildSnapshot(c, { proxyUp: true, hostsUp: 1 }).healthy, true);
});

test('keep-warm rides the generated routing (engine-correct on every host)', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = false;
    const dep = buildLitellmConfig(c).model_list[0];
    assert.equal(dep.litellm_params.keep_alive, c.ollama.keepAlive,
        'without this, any user request reset expiry to the server default — after a fallback that was 5m and every pause cost a model reload');
});

test('llama.cpp vision flag comes from the projector, not faith', () => {
    const c = defaultConfig();
    c.llamacpp.enabled = true;
    assert.ok(buildLitellmConfig(c).model_list[0].model_info.supports_vision, 'default model ships a projector');
    c.llamacpp.mmproj = null;
    assert.ok(!buildLitellmConfig(c).model_list[0].model_info,
        'text-only gguf must not advertise vision — OWUI would offer image upload that fails');
});

test('coordinator skips password-protected peers in the ROUTING too', () => {
    const c = defaultConfig();
    // Even if a keyed peer slipped past discovery filtering, the routing generator
    // is not the layer that knows about keys — discovery filters. This test pins
    // the DISCOVERY contract instead: a requiresKey snapshot is excluded.
    // (see discoverPeers in up.js — filter includes !p.snap.requiresKey)
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(upSrc.includes('!p.snap.requiresKey'), 'discoverPeers filters keyed peers');
    assert.ok(upSrc.includes('skipping password-protected peer'), 'and says so in the log');
});

test('gguf: native max + KV geometry from the real fleet model file', () => {
    const gguf = require('../src/gguf');
    const mp = path.join(__dirname, '..', '.models', 'Qwen3.8-27B-UD-IQ2_S.gguf');
    if (!fs.existsSync(mp)) return;   // fresh checkout — covered on fleet boxes
    const meta = gguf.readGgufMeta(mp);
    assert.equal(meta.contextLength, 262144, 'native max read from the header');
    const rate = gguf.kvGbPer16k(meta, 'q4_0');
    assert.ok(Math.abs(rate - 1.208) < 0.01, `computed KV rate ${rate} must match the measured 1.2 GB/16k`);
});

test('config: llamacpp.contextLength accepts auto (the default) and numbers, rejects junk', () => {
    assert.equal(ConfigSchema.parse({}).llamacpp.contextLength, 'auto');
    assert.equal(ConfigSchema.parse({ llamacpp: { contextLength: 32768 } }).llamacpp.contextLength, 32768);
    assert.ok(!ConfigSchema.safeParse({ llamacpp: { contextLength: 'huge' } }).success);
});

test('backendInfo never leaks the string auto into arithmetic consumers', () => {
    const c = defaultConfig();                     // contextLength: 'auto'
    c.llamacpp.enabled = true;
    const be = backendInfo(c, {});
    assert.equal(be.contextLength, null, 'unresolved auto → null, not a string');
    assert.equal(be.contextAuto, true);
    c.llamacpp.contextResolved = 65536;            // what `lol up` sets before spawn
    const be2 = backendInfo(c, {});
    assert.equal(be2.contextLength, 65536);
    assert.equal(be2.contextPerSlot, 65536);
});

// ---- seat gate (src/seats.js) ----------------------------------------------
const seatsMod = require('../src/seats');

test('config: seat gate defaults on, 15 min idle release, loopback port derivable', () => {
    const c = ConfigSchema.parse({});
    assert.equal(c.proxy.seatGate, true);
    assert.equal(c.proxy.seatIdleSec, 900);
    assert.equal(c.proxy.internalPort, null);      // up.js derives proxy.port + 1
    assert.ok(!ConfigSchema.safeParse({ proxy: { seatIdleSec: 5 } }).success, 'sub-minute release rejected');
});

test('seats: admit/refresh/full/idle-release lifecycle', () => {
    let t = 1000000;
    const s = seatsMod.createSeats({ capacity: () => 2, idleReleaseSec: () => 600, now: () => t });
    assert.equal(s.admit('10.0.0.1').ok, true, 'first IP takes seat 1');
    s.release('10.0.0.1');
    assert.equal(s.admit('::ffff:10.0.0.1').ok, true, 'v4-mapped spelling is the SAME seat');
    s.release('10.0.0.1');
    assert.equal(s.admit('10.0.0.2').ok, true, 'second IP takes seat 2');
    s.release('10.0.0.2');
    const refused = s.admit('10.0.0.3');
    assert.equal(refused.ok, false, 'third IP refused while both seats fresh');
    assert.equal(refused.cap, 2);
    t += 601 * 1000;                               // both idle past the release window
    assert.equal(s.admit('10.0.0.3').ok, true, 'idle seats were reclaimed');
    assert.equal(s.view().length, 1, 'only the newcomer holds a seat now');
});

test('seats: an in-flight generation is never reaped, however long it streams', () => {
    let t = 1000000;
    const s = seatsMod.createSeats({ capacity: () => 1, idleReleaseSec: () => 600, now: () => t });
    assert.equal(s.admit('10.0.0.1').ok, true);    // held: no release() yet — still streaming
    t += 3600 * 1000;                              // an hour later
    assert.equal(s.admit('10.0.0.2').ok, false, 'streaming holder still owns the seat');
    s.release('10.0.0.1');
    t += 601 * 1000;
    assert.equal(s.admit('10.0.0.2').ok, true, 'released + idle → reclaimed');
});

test('seats: only completion POSTs are gated', () => {
    assert.equal(seatsMod.isGated('POST', '/v1/chat/completions'), true);
    assert.equal(seatsMod.isGated('POST', '/v1/chat/completions?x=1'), true);
    assert.equal(seatsMod.isGated('POST', '/chat/completions'), true);
    assert.equal(seatsMod.isGated('POST', '/v1/completions'), true);
    assert.equal(seatsMod.isGated('GET', '/v1/chat/completions'), false);
    assert.equal(seatsMod.isGated('GET', '/v1/models'), false);
    assert.equal(seatsMod.isGated('POST', '/v1/models'), false);
    assert.equal(seatsMod.isGated('POST', '/v1/embeddings'), false);
});

test('seat gate: streams pass through, ungated GETs skip admit, full farm gets the OpenAI-style 429', async () => {
    const http = require('http');
    // Mock LiteLLM: echoes the path; the completions route streams two chunks.
    const upstream = http.createServer((req, res) => {
        if (req.url.startsWith('/v1/chat/completions')) {
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write('data: chunk1\n\n');
            setTimeout(() => { res.write('data: chunk2\n\n'); res.end(); }, 30);
        } else {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ path: req.url }));
        }
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    const upPort = upstream.address().port;
    let admits = 0; let releases = 0; let full = false;
    const seats = {   // scriptable registry: loopback tests can't vary source IPs
        admit: () => { admits++; return full ? { ok: false, cap: 2, used: 2 } : { ok: true, cap: 2, used: 1 }; },
        release: () => { releases++; },
        view: () => [],
    };
    const gate = await seatsMod.startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: upPort, seats, idleReleaseSec: () => 900 });
    const gatePort = gate.address().port;
    const fetchRaw = (method, p, body) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: gatePort, method, path: p, headers: { 'content-type': 'application/json' } }, (res) => {
            let buf = '';
            res.on('data', (c) => { buf += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: buf }));
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
    try {
        const models = await fetchRaw('GET', '/v1/models');
        assert.equal(models.status, 200);
        assert.equal(admits, 0, 'GET /v1/models must not consume a seat');
        const gen = await fetchRaw('POST', '/v1/chat/completions', '{"messages":[]}');
        assert.equal(gen.status, 200);
        assert.ok(gen.body.includes('chunk1') && gen.body.includes('chunk2'), 'streamed chunks pass through the gate');
        assert.equal(admits, 1);
        assert.equal(releases, 1, 'seat released when the stream finished');
        full = true;
        const refused = await fetchRaw('POST', '/v1/chat/completions', '{"messages":[]}');
        assert.equal(refused.status, 429);
        const err = JSON.parse(refused.body).error;
        assert.equal(err.code, 'lol_seats_full');
        assert.ok(/seats on this server are in use/.test(err.message), 'human-readable refusal (OWUI shows error.message)');
        assert.equal(releases, 1, 'a refused request releases nothing');
    } finally {
        gate.close();
        upstream.close();
    }
});

(async () => {
    for (const { name, fn } of tests) {
        try { await fn(); console.log(`  ok  ${name}`); passed++; }
        catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
    }
    console.log(`\n${passed} passed`);
})();
