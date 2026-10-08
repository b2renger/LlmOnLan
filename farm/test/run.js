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
    // Two hosts → somewhere to fail over to → the fast cooldown stays on.
    assert.equal(doc.router_settings.allowed_fails, 1);
    assert.ok(!('disable_cooldowns' in doc.router_settings));
});

test('litellm: a one-box farm never cools its only deployment (one glitch locked everyone out 60 s)', () => {
    // allowed_fails puts LiteLLM on its legacy cooldown path, which ignores its own
    // single-deployment rule — so with nowhere to fail over to, cooldowns are off.
    const one = defaultConfig();
    one.llamacpp.enabled = false;
    one.models = [{ id: 'gemma4:12b', default: true }, { id: 'qwen3:8b' }];   // 2 models, ONE host each
    assert.equal(buildLitellmConfig(one).router_settings.disable_cooldowns, true);
    const ext = defaultConfig();
    ext.external.enabled = true;
    const doc = buildLitellmConfig(ext);
    assert.equal(doc.model_list.filter((d) => d.model_name === ext.external.alias).length, 1);
    assert.equal(doc.router_settings.disable_cooldowns, true);
    // A coordinator peer adds a second deployment of the served name → failover → cooldown back on.
    const coord = buildLitellmConfig(defaultConfig(), [{ openaiBaseUrl: 'http://peer:4000/v1', models: ['gemma4:12b'] }]);
    const counts = {};
    for (const d of coord.model_list) counts[d.model_name] = (counts[d.model_name] || 0) + 1;
    assert.ok(Object.values(counts).some((n) => n > 1), 'the peer is a second deployment of the served name');
    assert.ok(!('disable_cooldowns' in coord.router_settings));
});

test('litellm master_key only present when configured', () => {
    const c = defaultConfig();
    assert.ok(!('master_key' in buildLitellmConfig(c).general_settings));
    // A client that leaves frees the engine slot on non-streaming calls too (test/litellm-cancel.js, plan 0.0).
    assert.equal(buildLitellmConfig(c).general_settings.cancel_on_disconnect, true);
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
    assert.deepEqual(yml.search.formats.sort(), ['html', 'json'], 'json format is the OWUI-403 gotcha');
    assert.equal(yml.server.secret_key, 'a'.repeat(64));
    assert.notEqual(yml.server.secret_key, 'ultrasecretkey', 'webapp exits on the default key');
    assert.equal(yml.server.limiter, false, 'trusted LAN — no Valkey dependency');
    assert.equal(yml.server.public_instance, false);
    assert.match(buildSettingsYaml('a'), /lol-settings v4/, 'version marker drives the upgrade path');
});

test('searxng v4 (web search v2 + Swisscows): only the probed engines, no Yandex, a school\'s back-off and a bounded wait', () => {
    const yml = yaml.load(buildSettingsYaml('a'.repeat(64)));
    const kept = ['duckduckgo web', 'bing', 'seznam', 'mojeek', 'qwant', 'swisscows', 'wikipedia'];
    assert.deepEqual(yml.use_default_settings.engines.keep_only, kept);
    assert.ok(!kept.includes('yandex') && !kept.includes('duckduckgo'), 'no Yandex (owner); not the CAPTCHA-walled html DuckDuckGo');
    // An engine listed under engines but not kept would be ADDED as a new engine with no module — so every
    // entry is a kept one, switched on (the onion engines are simply not loaded any more).
    assert.deepEqual(yml.engines.map((e) => e.name), kept);
    assert.ok(yml.engines.every((e) => e.disabled === false));
    // The stock settings mark Swisscows inactive, and SearXNG never loads an inactive engine, kept or not
    // (a scratch boot of the pinned SearXNG, 2026-10-06: without this line it was missing from /config).
    assert.equal(yml.engines.find((e) => e.name === 'swisscows').inactive, false);
    assert.equal(yml.engines.find((e) => e.name === 'duckduckgo web').timeout, 4.0);
    assert.deepEqual([yml.search.safe_search, yml.search.default_lang], [1, 'auto']);
    assert.deepEqual(yml.search.suspended_times, { SearxEngineAccessDenied: 600, SearxEngineTooManyRequests: 600, SearxEngineCaptcha: 3600 });
    assert.deepEqual(yml.outgoing, { request_timeout: 3.0, max_request_timeout: 5.0, retries: 0 });
});

test('searxng settings: a generated v3 file (or older) is upgraded to v4 with its secret; a hand-written one is left alone', () => {
    const { writeSettingsIfMissing } = require('../src/searxng');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-searxng-'));
    try {
        const file = path.join(dir, 'settings.yml');
        const secret = 'b'.repeat(64);
        fs.writeFileSync(file, `# Generated by \`lol up\` (lol-settings v2) — delete this file to regenerate (new secret).\nuse_default_settings: true\nserver:\n  secret_key: "${secret}"\n`);
        writeSettingsIfMissing(file);
        assert.match(fs.readFileSync(file, 'utf8'), /lol-settings v4/, 'a v2 file goes straight to v4');
        fs.writeFileSync(file, `# Generated by \`lol up\` (lol-settings v3) — delete this file to regenerate (new secret).\nuse_default_settings:\n  engines:\n    keep_only:\n      - bing\nserver:\n  secret_key: "${secret}"\n`);
        writeSettingsIfMissing(file);
        const up = fs.readFileSync(file, 'utf8');
        assert.match(up, /lol-settings v4/);
        assert.equal(yaml.load(up).server.secret_key, secret, 'the secret survives the upgrade');
        assert.ok(yaml.load(up).use_default_settings.engines.keep_only.includes('swisscows'), 'yesterday\'s v3 file gains Swisscows');
        writeSettingsIfMissing(file);
        assert.equal(fs.readFileSync(file, 'utf8'), up, 'a current file is not rewritten');
        const mine = '# my own settings\nuse_default_settings: true\n';
        fs.writeFileSync(file, mine);
        writeSettingsIfMissing(file);
        assert.equal(fs.readFileSync(file, 'utf8'), mine, 'a hand-written file is the operator\'s');
        fs.rmSync(file);
        writeSettingsIfMissing(file);
        assert.match(yaml.load(fs.readFileSync(file, 'utf8')).server.secret_key, /^[0-9a-f]{64}$/, 'a fresh file gets a fresh secret');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
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

test('registry: six farm services, config-gated (websearch+ocr on, tts+classify+stt+bus off)', () => {
    const c = defaultConfig();
    const svcs = makeServices();
    assert.deepEqual(svcs.map((s) => s.id), ['websearch', 'tts', 'ocr', 'bus', 'classify', 'stt']);
    assert.equal(svcs.find((s) => s.id === 'bus').enabled(c), false, 'the message bus is off by default (three more LAN ports)');
    assert.equal(svcs.find((s) => s.id === 'stt').enabled(c), false, 'speech to text off by default (plan v2: CPU first)');
    assert.equal(svcs.find((s) => s.id === 'classify').enabled(c), false, 'Classify off by default (plan v2: CPU contention first)');
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
    // The NVFP4 entry (measured +45% prefill on Blackwell 2026-09-07) must stay
    // opt-in and must never become the default: it needs a 16 GB+ Blackwell card,
    // while the default has to work on the fleet's 12 GB ones.
    const nv = lib.find((e) => e.id === 'qwen3.8-27b-nvfp4-mtp');
    assert.ok(nv, 'the measured NVFP4 quant is offered');
    assert.notEqual(nv.url, c.llamacpp.model, 'offered, never the default');
    assert.ok(nv.sizeGb > 12, 'sized honestly — it does not fit a 12 GB card');
    assert.match(nv.note, /Blackwell/, 'the hardware caveat is in the text the operator reads');
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
    const job = { id: 'j-1', kind: 'model', label: 'Loading X', message: 'downloading', percent: 40, done: false, bytes: 10, total: 25 };
    const s1 = buildSnapshot(c, { getJob: () => job });
    assert.deepEqual(s1.busy, { kind: 'model', label: 'Loading X', message: 'downloading', percent: 40 }, 'what clients read, not the panel\'s job view');
    const s2 = buildSnapshot(c, { getJob: () => null });
    assert.equal(s2.busy, null, 'no job → busy null');
    assert.equal(buildSnapshot(c, { getJob: () => ({ ...job, done: true }) }).busy, null, 'a finished job lingers for the panel, not for clients');
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

test('fitBudget: budgets against the VRAM FREE at sizing time, less the reserve — not the whole card (plan 0.7)', () => {
    // The PRO 6000 beside ComfyUI: 96 GB card, ~45 GB held by another app.
    const shape = { vramGb: 96, weightsGb: 7.8, mmprojGb: 0.9, kvCacheType: 'q4_0', contextLength: 262144 };
    const alone = perfMod.fitBudget(shape);
    const shared = perfMod.fitBudget({ ...shape, freeGb: 51 });
    assert.equal(alone.usableGb, 96, 'free unknown → the whole card, as before');
    assert.equal(shared.usableGb, 51);
    assert.ok(shared.maxContext < alone.maxContext, `${shared.maxContext} < ${alone.maxContext}`);
    const need = (ctx) => 7.8 + 0.9 + perfMod.OVERHEAD_GB + (ctx / 16384) * perfMod.KV_GB_PER_16K.q4_0;
    assert.ok(need(shared.maxContext) <= 51 - perfMod.MARGIN_GB, 'the pool it picks fits what was free');
    assert.ok(need(alone.maxContext) > 51, 'the old total-VRAM pick would not have');
    assert.equal(perfMod.fitBudget({ ...shape, freeGb: 120 }).maxContext, alone.maxContext, 'free never counts past the card');
    const reserved = perfMod.fitBudget({ ...shape, freeGb: 51, reserveGb: 10 });
    assert.equal(reserved.usableGb, 41, 'llamacpp.gpuReserveGb comes off the top');
    assert.ok(reserved.maxContext < shared.maxContext);
    const small = perfMod.fitBudget({ ...shape, freeGb: 20 });
    assert.deepEqual([alone.fits, small.fits], [true, false], '262144 fits the empty card, not 20 GB of it');
    assert.equal(ConfigSchema.parse({}).llamacpp.gpuReserveGb, 0);
    assert.equal(ConfigSchema.safeParse({ llamacpp: { gpuReserveGb: -1 } }).success, false);
});

test('llama.cpp auto context: nothing fits the free VRAM → the 4096 floor, not 16384; no verdict → 16384 (review 2026-10-07)', () => {
    const { autoLlamacppContext } = require('../src/commands/up');
    const full = perfMod.fitBudget({ vramGb: 96, freeGb: 9, weightsGb: 7.8, mmprojGb: 0.9, kvCacheType: 'q4_0', contextLength: 16384 });
    assert.equal(full.maxContext, 0, 'the weights alone fill what is free');
    assert.equal(autoLlamacppContext(full), 4096);
    assert.equal(autoLlamacppContext({ maxContext: 65536 }), 65536, 'what fits');
    assert.equal(autoLlamacppContext({ maxContext: null }), 16384, 'no VRAM reading');
    assert.equal(autoLlamacppContext(null), 16384, 'no model file to read');
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

test('clock watch: a GPU busy but stuck under half its max clock (the GB10 latch) is said on the panel; idle clocks and a dip are not (owner 2026-10-07)', () => {
    const feed = (w, g, n = 1) => { let r; for (let i = 0; i < n; i++) r = w(g); return r; };
    const healthy = { gpuUtil: 94, smMhz: 2464, smMaxMhz: 2502 };   // the Spark after the drain, under load
    const latched = { gpuUtil: 94, smMhz: 702, smMaxMhz: 2502 };    // the Spark before it (92–96 % at 702 MHz)
    const idle = { gpuUtil: 0, smMhz: 202, smMaxMhz: 3090 };        // an idle PRO 6000 clocks down on purpose
    let w = perfMod.makeClockWatch();
    assert.equal(feed(w, healthy, 5), null);
    assert.equal(feed(w, idle, 10), null, 'an idle GPU at a low clock is normal');
    assert.equal(feed(w, latched, 2), null, 'two busy samples are not yet sustained');
    assert.equal(w(latched), 702, 'the third in a row raises it');
    assert.equal(feed(w, { ...latched, gpuUtil: 3 }, 20), 702, 'idle samples keep it: the latch outlives the load');
    assert.equal(w(healthy), null, 'one busy sample at a normal clock clears it');
    w = perfMod.makeClockWatch();
    const dip = { gpuUtil: 90, smMhz: 900, smMaxMhz: 2502 };
    assert.equal([dip, dip, healthy, dip, dip].map(w).every((r) => r === null), true, 'a dip that recovers never raises it');
    assert.equal(w({ ...dip, smMhz: 1300 }), null, 'half the max clock or above is not stuck');
    for (const g of [{ ...latched, smMhz: null }, { ...latched, gpuUtil: null }, null]) {
        w = perfMod.makeClockWatch();
        assert.equal(feed(w, g, 5), null, `no verdict without the readings: ${JSON.stringify(g)}`);
    }
    // A GB10 may not report its max clock: the fixed floor still catches the latch.
    w = perfMod.makeClockWatch();
    assert.equal(feed(w, { ...latched, smMaxMhz: null }, 3), 702, 'no max clock reported: 702 MHz busy is still stuck');
    // A 300 W card dipping under half its max mid-prefill, but well above the floor, is not stuck.
    w = perfMod.makeClockWatch();
    assert.equal(feed(w, { gpuUtil: 99, smMhz: 1350, smMaxMhz: 2850 }, 5), null, 'a power-capped dip above the floor is not stuck');
    const render = loadPanel();
    const gpu = { gpuUtil: 94, vramUsedGb: 80, vramTotalGb: 119, smMhz: 702, smMaxMhz: 2502 };
    const html = render(adminState({ health: { hostsUp: 1, hostsTotal: 1, proxyUp: true, host: null, gpu: { ...gpu, stuckMhz: 702 } } }));
    assert.ok(html.includes('The GPU is stuck at a low clock (702 MHz): fully power the box off (unplug it for a minute), then start it again.'), 'the warning line');
    assert.ok(!render(adminState({ health: { hostsUp: 1, hostsTotal: 1, proxyUp: true, host: null, gpu: { ...gpu, stuckMhz: null } } })).includes('stuck at a low clock'), 'no latch, no line');
    assert.ok(!render(adminState()).includes('stuck at a low clock'), 'no GPU readings, no line');
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

test('backendInfo never asserts Ollama settings it cannot verify', () => {
    const c = defaultConfig();                       // kvCacheType q8_0, numParallel 2
    // Daemon we started: our env applied, so the config IS the truth.
    const managed = backendInfo(c, { hostsUp: 1, ollamaManaged: true });
    assert.equal(managed.kvCacheType, 'q8_0');
    assert.equal(managed.slotsVerified, true);
    assert.equal(managed.slots, 2);
    // Daemon somebody else started: same numbers requested, but unverifiable.
    // The live 2026-09-07 case — advertised q8_0/2 while it ran f16/n_slots=1.
    const foreign = backendInfo(c, { hostsUp: 1, ollamaManaged: false });
    assert.equal(foreign.kvCacheType, null, 'unknown KV type must be null, never a hardcoded f16');
    assert.equal(foreign.slotsVerified, false);
    assert.equal(foreign.slots, 2, 'still reported (seats keep using it) — but flagged');
    // Old callers / llama.cpp are unaffected.
    assert.equal(backendInfo(c, {}).slotsVerified, true, 'absent flag = assume managed');
    const lc = defaultConfig(); lc.llamacpp.enabled = true;
    assert.equal(backendInfo(lc, {}).slotsVerified, true, 'we spawn llama-server ourselves');
});

// ---- download progress feedback (owner report 2026-09-10) -------------------
const upMod = require('../src/commands/up');

test('pullModel hands callers the PARSED object on every line, not a status string', async () => {
    // The regression this locks: pullModel used to emit obj.status (a string) and
    // only when the status CHANGED, so total/completed/digest never reached the
    // caller and a long single-layer download emitted nothing at all — the admin
    // panel's pull bar sat on 'starting …' for the whole download.
    const http = require('http');
    const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        // Two progress lines with the SAME status — the old code emitted one.
        res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
        res.write(JSON.stringify({ status: 'pulling abc123', digest: 'sha256:abc123', total: 1000, completed: 100 }) + '\n');
        res.write(JSON.stringify({ status: 'pulling abc123', digest: 'sha256:abc123', total: 1000, completed: 600 }) + '\n');
        res.write(JSON.stringify({ status: 'success' }) + '\n');
        res.end();
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const seen = [];
    try {
        await ollama.pullModel(`http://127.0.0.1:${srv.address().port}`, 'x:1b', (o) => seen.push(o));
    } finally { srv.close(); }
    assert.equal(seen.length, 4, 'every line reaches the caller, including repeats of one status');
    assert.ok(seen.every((o) => o && typeof o === 'object'), 'objects, never strings');
    assert.equal(seen[1].completed, 100);
    assert.equal(seen[2].completed, 600, 'byte progress within ONE layer must get through');
    assert.equal(seen[1].digest, 'sha256:abc123', 'digest reaches the caller so layers can be summed');
    // And the console formatter turns that into something readable.
    assert.match(ollama.pullProgressText(seen[2]), /0\.0\/0\.0 GB \(60%\)/);
    assert.equal(ollama.pullProgressText(seen[0]), 'pulling manifest', 'no byte suffix without a size');
});

test('pullPhase never leaks a raw digest into the UI', () => {
    // The status an operator sees most often is 'pulling <digest>' — the least
    // meaningful string Ollama emits. That must never reach the panel.
    assert.equal(upMod.pullPhase('pulling 8934d96d3f08'), 'downloading');
    assert.equal(upMod.pullPhase('pulling manifest'), 'reading the model index');
    assert.equal(upMod.pullPhase('verifying sha256 digest'), 'checking the download is intact');
    assert.equal(upMod.pullPhase('writing manifest'), 'saving');
    assert.equal(upMod.pullPhase('success'), 'finishing up');
    assert.equal(upMod.pullPhase(''), 'downloading');
    for (const raw of ['pulling 8934d96d3f08', 'pulling manifest', 'verifying sha256 digest']) {
        assert.ok(!/[0-9a-f]{8}|sha256/.test(upMod.pullPhase(raw)), `digest/hash leaked for "${raw}"`);
    }
});

test('makeRateMeter: samples at most once a second, smooths, never goes negative', () => {
    const m = upMod.makeRateMeter();
    let t = 1_000_000;
    const realNow = Date.now;
    Date.now = () => t;
    try {
        assert.equal(m.sample(0).bytesPerSec, null, 'no rate from a single sample');
        t += 500;
        assert.equal(m.sample(50e6).bytesPerSec, null, 'under 1 s is ignored — a chunked stream would swing wildly');
        t += 600;                                  // 1.1 s since the first sample
        const r1 = m.sample(110e6).bytesPerSec;    // 110 MB in 1.1 s = 100 MB/s
        assert.ok(r1 > 90e6 && r1 < 110e6, `first rate ~100 MB/s, got ${r1}`);
        // A restart (next host, layer recount) can move the byte count backwards.
        // That must not produce a negative speed — it keeps the last known rate.
        t += 1000;
        const r2 = m.sample(10e6).bytesPerSec;
        assert.ok(r2 > 0, `backwards bytes must not yield a negative rate, got ${r2}`);
    } finally {
        Date.now = realNow;
    }
});

test('panel formats download numbers for a person, not a debugger', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
    const start = html.indexOf('function sizeOf');
    const end = html.indexOf('function esc');
    assert.ok(start > 0 && end > start, 'panel source moved — update the extraction anchors');
    const ctx = {};
    new Function('ctx', html.slice(start, end) + '; ctx.out = { sizeOf, rateOf, etaOf };')(ctx);
    const { sizeOf, rateOf, etaOf } = ctx.out;
    // The unit has to follow the number: a 600 MB projector shown as '0.6 GB'
    // hides the progress it is meant to prove.
    assert.equal(sizeOf(600e6), '600 MB');
    assert.equal(sizeOf(14.46e9), '14.5 GB');
    assert.equal(rateOf(48e6), '48 MB/s');
    // ETA is for deciding whether to wait — rounded words, never raw seconds.
    assert.equal(etaOf(10), 'a few seconds left');
    assert.equal(etaOf(42), 'less than a minute left', '42 s is not "a few seconds" — that read as a lie in testing');
    assert.equal(etaOf(70), 'about a minute left');
    assert.equal(etaOf(360), 'about 6 min left');
    assert.match(etaOf(7500), /^about 2h/);
    assert.equal(etaOf(null), '');
});

// ---- external engine (vLLM/SGLang/… — a server we route to but never run) ---
test('external engine config defaults: off, keyless, declared capacity', () => {
    const c = ConfigSchema.parse({});
    assert.equal(c.external.enabled, false, 'must never hijack an existing farm');
    assert.equal(c.external.alias, 'assistant');
    assert.equal(c.external.model, null, 'null = pass the alias through unchanged');
    assert.equal(c.external.apiKey, null);
    assert.equal(c.external.vision, false);
    assert.ok(!ConfigSchema.safeParse({ external: { baseUrl: 'not-a-url' } }).success);
    assert.ok(!ConfigSchema.safeParse({ external: { nope: 1 } }).success, 'strict');
});

test('external engine is exclusive: it alone is routed, peers still aggregate', () => {
    const c = defaultConfig();
    c.external.enabled = true;
    c.external.alias = 'assistant';
    c.external.baseUrl = 'http://127.0.0.1:8000/v1';
    c.external.model = 'deepseek-v4-flash-0731';
    c.llamacpp.enabled = true;              // both on → external wins, llama.cpp stands down
    const doc = buildLitellmConfig(c, [{ openaiBaseUrl: 'http://10.0.0.9:4000/v1', models: ['assistant'] }]);
    const names = doc.model_list.map((m) => m.model_name);
    assert.deepEqual([...new Set(names)], ['assistant'], 'nothing but the external alias is served');
    const local = doc.model_list[0];
    assert.equal(local.litellm_params.model, 'hosted_vllm/deepseek-v4-flash-0731', 'backend is asked for ITS id');
    assert.equal(local.litellm_params.api_base, 'http://127.0.0.1:8000/v1');
    assert.equal(doc.model_list.length, 2, 'local + the peer that serves the alias');
    assert.equal(doc.model_list[1].litellm_params.api_base, 'http://10.0.0.9:4000/v1');
    assert.equal(doc.model_list[1].litellm_params.model, 'openai/assistant', 'a peer is another farm\'s LiteLLM: plain OpenAI');
    // No Ollama deployment may survive — one engine at a time.
    assert.equal(doc.model_list.some((m) => /ollama/.test(m.litellm_params.model)), false);
});

test('external engine: alias passes through when no backend model id is set', () => {
    const c = defaultConfig();
    c.external.enabled = true;
    c.external.alias = 'assistant';
    const doc = buildLitellmConfig(c, []);
    assert.equal(doc.model_list[0].litellm_params.model, 'hosted_vllm/assistant');
    assert.equal(doc.model_list[0].litellm_params.api_key, 'sk-lol-external', 'keyless backends still need a value');
});

test('external engine: snapshot advertises it, and never claims to have measured it', () => {
    const c = defaultConfig();
    c.external.enabled = true;
    c.external.label = 'DeepSeek v4 Flash (vLLM)';
    c.external.contextLength = 384000;
    c.external.parallel = 8;
    const be = backendInfo(c, {});
    assert.equal(be.engine, 'external');
    assert.equal(be.model, 'DeepSeek v4 Flash (vLLM)');
    assert.equal(be.contextLength, 384000);
    assert.equal(be.contextPerSlot, 384000, 'these servers do not split the window across slots');
    assert.equal(be.slots, 8);
    assert.equal(be.slotsVerified, false, 'declared by the operator, not measured');
    const snap = buildSnapshot(c, { endpoint: 'http://10.0.0.5:4000', id: 'x', engineUp: true });
    assert.deepEqual(snap.models.map((m) => m.id), ['assistant'], 'clients see the alias only');
    assert.equal(snap.models[0].underlying, 'DeepSeek v4 Flash (vLLM)', 'the label, not a .gguf name');
    assert.equal(snap.healthy, true);
    // A backend that stops answering must make the farm unhealthy so clients move.
    assert.equal(buildSnapshot(c, { endpoint: 'http://10.0.0.5:4000', id: 'x', engineUp: false }).healthy, false);
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

test('seats: only generation POSTs are gated — every route LiteLLM generates on (plan 0.2)', () => {
    for (const p of ['/v1/chat/completions', '/v1/chat/completions?x=1', '/chat/completions', '/v1/completions', '/completions',
        '/v1/chat/completions/', '/engines/m/chat/completions', '/openai/deployments/m/completions',
        '/v1/responses', '/responses', '/openai/v1/responses', '/v1/responses/compact', '/v1/messages',
        '/v1beta/models/m:generateContent', '/v1beta/models/m:streamGenerateContent', '/models/m:generateContent', '/v1beta/interactions',
        '/v1/chat%2Fcompletions', '/v1/%63hat/completions', '/v1/%zz']) {   // uvicorn routes on the DECODED path; undecodable → gated
        assert.equal(seatsMod.isGated('POST', p), true, p);
    }
    for (const p of ['/v1/models', '/v1/embeddings', '/v1/messages/count_tokens', '/v1/threads/t/messages', '/v1/responses/r/cancel', '/utils/token_counter']) {
        assert.equal(seatsMod.isGated('POST', p), false, p);
    }
    assert.equal(seatsMod.isGated('GET', '/v1/chat/completions'), false);
    assert.equal(seatsMod.isGated('GET', '/v1/models'), false);
});

// The routes the gate forwards at all (pre-release review 2026-10-07): LiteLLM's pass-through routes
// reached vLLM with no seat, and a decoded '..', '?' or '#' re-aimed them.
const GATE_ALLOWED = [
    ['POST', '/v1/chat/completions'], ['POST', '/chat/completions'], ['POST', '/v1/completions'], ['POST', '/completions'],
    ['POST', '/v1/chat/completions?x=1'], ['POST', '/v1/chat/completions/'], ['POST', '/v1/chat%2Fcompletions'],
    ['POST', '/engines/m/chat/completions'], ['POST', '/engines/m/completions'], ['POST', '/openai/deployments/m/chat/completions'],
    ['POST', '/openai/deployments/m/completions'], ['POST', '/v1/responses'], ['POST', '/responses'], ['POST', '/openai/v1/responses'],
    ['POST', '/v1/responses/compact'], ['POST', '/v1/messages'], ['POST', '/v1beta/models/m:generateContent'],
    ['POST', '/v1beta/models/m:streamGenerateContent?alt=sse'], ['POST', '/models/m:generateContent'], ['POST', '/v1beta/interactions'],
    ['POST', '/interactions'], ['GET', '/v1/models'], ['GET', '/models'], ['GET', '/v1/models/gemma4:12b'],
    ['GET', '/model_group/info'], ['GET', '/health/liveliness'], ['OPTIONS', '/v1/chat/completions'], ['OPTIONS', '/v1/models'],
];
const GATE_REFUSED = [
    ['POST', '/vllm/../invocations', 400], ['POST', '/vllm/%2E%2E/x', 400], ['POST', '/v1/%2e%2e/invocations', 400],
    ['POST', '/vllm/chat/completions%3Fx', 400], ['POST', '/azure/chat/completions%23/assistant', 400],
    ['POST', '/azure_ai/x%23/assistant', 400], ['POST', '/azure/chat/completions%3F/assistant', 400],
    ['GET', '/v1/models%00', 400], ['POST', '/v1/%zz', 400],
    ['POST', '/vllm/chat/completions', 404], ['POST', '/vllm/messages', 404], ['POST', '/vllm/invocations', 404],
    ['POST', '/azure/chat/completions', 404], ['POST', '/anthropic/v1/messages', 404], ['POST', '/openai/v1/chat/completions', 404],
    ['POST', '/cursor/chat/completions', 404], ['POST', '/queue/chat/completions', 404], ['POST', '/bedrock/model/m/invoke', 404],
    ['GET', '/health', 404], ['GET', '/health/readiness', 404], ['POST', '/v1/embeddings', 404], ['POST', '/v1/messages/count_tokens', 404],
    ['POST', '/key/generate', 404], ['GET', '/model/info', 404], ['GET', '/ui', 404], ['GET', '/', 404], ['POST', '/v1/models', 404],
    ['GET', '/v1/chat/completions', 404], ['OPTIONS', '/vllm/chat/completions', 404], ['POST', '/tokenize', 404], ['POST', '/invocations', 404],
];

test('seat gate: forwards only the routes the farm serves; LiteLLM\'s pass-through routes and re-aimed paths never reach it, nor a seat (review 2026-10-07)', async () => {
    for (const [m, p] of GATE_ALLOWED) assert.equal(seatsMod.refusal(m, p), 0, `${m} ${p}`);
    for (const [m, p, code] of GATE_REFUSED) assert.equal(seatsMod.refusal(m, p), code, `${m} ${p}`);
    // Every generation route the gate lets through takes a seat: the allowlist never opens an unseated way in.
    for (const [m, p] of GATE_ALLOWED) if (m === 'POST') assert.equal(seatsMod.isGated(m, p), true, `${m} ${p} is seated`);

    const http = require('http');
    const reached = [];
    const upstream = http.createServer((req, res) => { reached.push(`${req.method} ${req.url}`); req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    let admits = 0;
    const real = seatsMod.createSeats({ capacity: () => 1, idleReleaseSec: () => 900 });
    const seats = { ...real, admit: (ip) => { admits++; return real.admit(ip); } };
    const gate = await seatsMod.startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: upstream.address().port, seats, idleReleaseSec: () => 900 });
    const send = (method, p) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: gate.address().port, method, path: p, headers: { 'content-type': 'application/json', origin: 'null' } }, (res) => {
            let buf = ''; res.on('data', (c) => { buf += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
        });
        req.on('error', reject);
        req.end(method === 'POST' ? '{"model":"assistant","messages":[]}' : undefined);
    });
    try {
        for (const [m, p, code] of GATE_REFUSED) {
            const r = await send(m, p);
            assert.equal(r.status, code, `${m} ${p}`);
            assert.equal(r.headers['access-control-allow-origin'], '*', 'a page on another origin can read why');
            assert.equal(JSON.parse(r.body).error.code, code === 400 ? 'lol_bad_path' : 'lol_not_found');
        }
        assert.deepEqual(reached, [], 'nothing refused reached LiteLLM');
        assert.equal(admits, 0, 'and none asked for a seat');
        assert.equal(real.view().length, 0, 'no seat is held');
        for (const [m, p] of GATE_ALLOWED) assert.equal((await send(m, p)).status, 200, `${m} ${p}`);
        assert.deepEqual(reached, GATE_ALLOWED.map(([m, p]) => `${m} ${p}`), 'every allowed route reaches it, its path untouched');
        assert.equal(admits, GATE_ALLOWED.filter(([m]) => m === 'POST').length, 'each generation through a seat, nothing else');
    } finally {
        gate.close();
        upstream.close();
    }
});

test('seats: a refusal says when the soonest IDLE seat frees; none when every seat is generating (plan 0.2)', () => {
    let t = 1000000;
    const s = seatsMod.createSeats({ capacity: () => 2, idleReleaseSec: () => 600, now: () => t });
    s.admit('10.0.0.1');                            // generating (no release)
    s.admit('10.0.0.2');
    assert.equal(s.admit('10.0.0.3').retrySec, null, 'both generating → nothing to promise');
    s.release('10.0.0.2');                         // done at t
    t += 100 * 1000;
    assert.equal(s.admit('10.0.0.3').retrySec, 500, '600 s window − 100 s idle');
    t += 499.5 * 1000;
    assert.equal(s.admit('10.0.0.3').retrySec, 1, 'rounds up, never 0');
});

test('workshop setting: Apply\'s seatIdleSec is refused out of range, changes the live gate with no restart, persists (plan 1.2)', () => {
    const f = path.join(os.tmpdir(), `lol-idle-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify({ name: 'Mine', proxy: { port: 4000 } }));
    try {
        const config = defaultConfig();
        // The registry the farm builds, reading the same thunk up.js wires (config.proxy.seatIdleSec).
        let t = 1000000;
        const s = seatsMod.createSeats({ capacity: () => 1, idleReleaseSec: () => config.proxy.seatIdleSec || 900, now: () => t });
        s.admit('10.0.0.1'); s.release('10.0.0.1');
        t += 150 * 1000;
        assert.equal(s.admit('10.0.0.2').retrySec, 750, 'the default 15 min: 900 − 150 s');

        for (const bad of [30, 59, 3601, 90.5, '', 'two', true]) {
            assert.match(upMod.seatIdleChange(config, f, bad).error, /1 to 60 minutes/, String(bad));
        }
        assert.equal(upMod.seatIdleChange(config, f, undefined), null, 'absent: unchanged');
        assert.equal(upMod.seatIdleChange(config, f, 900), null, 'the current value: nothing to do');
        assert.deepEqual(readRawConfig(f), { name: 'Mine', proxy: { port: 4000 } }, 'validating writes nothing');

        const ch = upMod.seatIdleChange(config, f, '120');   // seconds; a string reads as its number, as slots does
        assert.equal(ch.label, 'idle seats free after 2 min');
        assert.equal(ch.apply(), null, 'saved without a warning');
        // The same registry, never rebuilt: the idle seat is now past the hold and goes to the newcomer.
        assert.equal(s.admit('10.0.0.2').ok, true, 'reclaimed at once under the 2 min hold');
        s.release('10.0.0.2');
        t += 30 * 1000;
        assert.equal(s.admit('10.0.0.3').retrySec, 90, 'Retry-After follows: 120 − 30 s');
        assert.deepEqual(readRawConfig(f), { name: 'Mine', proxy: { port: 4000, seatIdleSec: 120 } }, 'only the one key added');
        assert.equal(ConfigSchema.parse(readRawConfig(f)).proxy.seatIdleSec, 120, 'and it boots with it');
        assert.equal(upMod.seatIdleChange(config, null, 600).apply().includes('not saved'), true, 'an unwritable file says so; the change still applies');
        assert.equal(config.proxy.seatIdleSec, 600);
    } finally { fs.unlinkSync(f); }
});

test('panel: "Free an idle seat after" shows while the seat gate is on, minutes on screen over seconds in the value (plan 1.2)', () => {
    const render = loadPanel();
    const html = render(adminState({ capacity: { slots: 2, clients: 0, seats: [], seatIdleSec: 120, slotsVerified: true, unmanagedHosts: [] } }));
    const sel = /<select id="idle-sel" data-orig="(\d+)">([\s\S]*?)<\/select>/.exec(html);
    assert.ok(sel, 'the control is rendered');
    assert.equal(sel[1], '120', 'compared in seconds, the value Apply sends');
    assert.match(sel[2], /<option value="120" selected>2 min<\/option>/);
    assert.match(sel[2], /<option value="900">15 min<\/option>/, 'the default is one click away');
    assert.ok(html.includes('suits a workshop'));
    assert.ok(/<option value="90" selected>1\.5 min</.test(render(adminState({ capacity: { slots: 2, clients: 0, seats: [], seatIdleSec: 90, slotsVerified: true, unmanagedHosts: [] } }))),
        'a hand-set value is shown as it is');
    assert.ok(!render(adminState({ capacity: { slots: 2, clients: 0, seats: null, seatIdleSec: null, slotsVerified: true, unmanagedHosts: [] } })).includes('idle-sel'),
        'gate off (proxy.seatGate false): no control');
    const ext = render(adminState({
        backend: { engine: 'external', alias: 'assistant', model: 'm', baseUrl: 'http://10.0.0.5:8000/v1', contextLength: 32768, contextPerSlot: 32768, slots: 4, slotsVerified: false },
        capacity: { slots: 4, clients: 0, seats: [], seatIdleSec: 900, slotsVerified: false, unmanagedHosts: [] },
    }));
    assert.ok(ext.includes('id="idle-sel"'), 'the gate is the farm\'s own, so an external server keeps the control');
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
    let admits = 0; let releases = 0; let full = false; let retrySec = null;
    const seats = {   // scriptable registry: loopback tests can't vary source IPs
        admit: () => { admits++; return full ? { ok: false, cap: 2, used: 2, retrySec } : { ok: true, cap: 2, used: 1 }; },
        release: () => { releases++; },
        view: () => [],
    };
    const gate = await seatsMod.startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: upPort, seats, idleReleaseSec: () => 900 });
    const gatePort = gate.address().port;
    const fetchRaw = (method, p, body) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: gatePort, method, path: p, headers: { 'content-type': 'application/json' } }, (res) => {
            let buf = '';
            res.on('data', (c) => { buf += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
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
        // Retry-After and the sentence agree (plan 0.2): every seat generating → the idle window …
        assert.equal(refused.headers['retry-after'], '900');
        assert.ok(/generating right now/.test(err.message) && /15 min/.test(err.message), err.message);
        // … an idle seat → the seconds until it is reclaimed, said the same way in words.
        retrySec = 125;
        const idle = await fetchRaw('POST', '/v1/responses', '{"input":"x"}');
        assert.equal(idle.status, 429, '/v1/responses is gated too');
        assert.equal(idle.headers['retry-after'], '125');
        assert.ok(/frees in about 2 min/.test(JSON.parse(idle.body).error.message), idle.body);
    } finally {
        gate.close();
        upstream.close();
    }
});

test('seat gate: on a passworded farm a missing or wrong key gets a 401 and NO seat; the right one is seated (plan 0.1)', async () => {
    const http = require('http');
    let upstreamHits = 0;
    const upstream = http.createServer((req, res) => { upstreamHits++; req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    const seats = seatsMod.createSeats({ capacity: () => 1, idleReleaseSec: () => 900 });
    let pw = 'farm-pw';
    const gate = await seatsMod.startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: upstream.address().port, seats, idleReleaseSec: () => 900, password: () => pw });
    const post = (p, headers = {}) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: gate.address().port, method: p === '/v1/models' ? 'GET' : 'POST', path: p, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
            let buf = ''; res.on('data', (c) => { buf += c; }); res.on('end', () => resolve({ status: res.statusCode, body: buf }));
        });
        req.on('error', reject);
        req.end(p === '/v1/models' ? undefined : '{"messages":[]}');
    });
    try {
        for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: 'Bearer farm-pw-and-more' }, { 'x-api-key': 'farm' }]) {
            const r = await post('/v1/chat/completions', headers);
            assert.equal(r.status, 401, JSON.stringify(headers));
            const e = JSON.parse(r.body).error;
            assert.equal(e.code, 'invalid_api_key');
            assert.ok(/password/.test(e.message) && /Authorization/.test(e.message), 'says what is wrong, in words the client classes as auth');
        }
        assert.equal(seats.view().length, 0, 'no seat was claimed by a refused key');
        assert.equal(upstreamHits, 0, 'nothing reached LiteLLM');
        assert.equal((await post('/v1/models')).status, 200, 'ungated routes are LiteLLM\'s business, as before');
        assert.equal((await post('/v1/chat/completions', { authorization: 'Bearer farm-pw' })).status, 200);
        assert.equal((await post('/v1/messages', { 'x-api-key': 'farm-pw' })).status, 200, 'Anthropic-style clients send x-api-key');
        assert.equal(seats.view().length, 1, 'the right key takes the seat');
        pw = 'rotated';
        assert.equal((await post('/v1/chat/completions', { authorization: 'Bearer farm-pw' })).status, 401, 'a password changed in the panel applies at once');
        pw = null;
        assert.equal((await post('/v1/chat/completions')).status, 200, 'no password → an open farm, unchanged');
    } finally {
        gate.close();
        upstream.close();
    }
});

test('gate stats: counts, the rolling hour, the fullest moment, first-word percentiles, a fixed size (plan 3.3)', () => {
    let t = 60000 * 29000000;                       // a minute boundary
    const st = seatsMod.createGateStats({ now: () => t });
    st.unauthorized();
    st.admitted(1, 3);
    st.admitted(3, 3);
    st.refused(3, 3);
    st.cancelled(true);
    st.cancelled(false);
    for (let i = 0; i < 18; i++) st.firstByte(400);
    st.firstByte(2500);
    st.firstByte(400000);                           // past the last bin edge
    let h = st.view().lastHour;
    assert.deepEqual([h.admitted, h.refused, h.unauthorized, h.cancelled, h.cancelledBeforeFirstByte], [2, 1, 1, 2, 1]);
    assert.deepEqual([h.peakSeats, h.peakOf, h.peakAt], [3, 3, t]);
    assert.equal(h.timed, 20);
    assert.equal(h.ttfbP50Ms, 500, 'the 400 ms bin reads "within 0.5 s"');
    assert.equal(h.ttfbP95Ms, 3000, '19 of 20 within 3 s');
    assert.equal(h.ttfbMaxMs, 400000);
    assert.equal(st.view().startedAt, 60000 * 29000000);

    t += 5 * 60000;
    st.admitted(3, 3);                              // as full again later: the LATEST time is kept
    t += 25 * 60000;
    st.refused(2, 3);
    h = st.view().lastHour;
    assert.deepEqual([h.refused, h.peakSeats, h.peakAt], [2, 3, 60000 * 29000000 + 5 * 60000]);

    t = 60000 * 29000000 + 66 * 60000;              // minutes 0 and +5 are out of the hour; +30 is in
    h = st.view().lastHour;
    assert.deepEqual([h.admitted, h.refused, h.unauthorized, h.cancelled, h.timed], [0, 1, 0, 0, 0]);
    assert.deepEqual([h.peakSeats, h.ttfbP50Ms, h.ttfbP95Ms, h.ttfbMaxMs], [2, null, null, null]);
    t += 5 * 60000;
    st.admitted(1, 3);
    assert.equal(st.view().lastHour.peakSeats, 2, 'the fullest moment in the window, not the last one');
    const all = st.view().sinceStart;
    assert.deepEqual([all.admitted, all.refused, all.unauthorized, all.cancelled, all.timed, all.peakSeats], [4, 2, 1, 2, 20, 3]);

    t += 3 * 3600 * 1000;
    h = st.view().lastHour;
    assert.deepEqual([h.admitted, h.refused, h.peakSeats, h.peakAt], [0, 0, 0, null], 'a quiet hour reads as quiet');

    // Never more than the hour's 60 buckets, however long or busy: 100 000 events over 5 hours.
    const small = seatsMod.createGateStats({ now: () => t }).minutes;
    for (let i = 0; i < 100000; i++) { t += 180; st.admitted(i % 4, 3); st.firstByte(i % 9000); if (i % 7 === 0) st.refused(3, 3); }
    assert.equal(st.minutes.length, 60);
    assert.ok(st.minutes.every((b) => b.ttfb.length === small[0].ttfb.length), 'fixed bins');
    assert.ok(JSON.stringify({ m: st.minutes, t: st.total }).length < 30000, 'a few KB, whatever the traffic');
    assert.equal(st.view().sinceStart.admitted, 100004);
    // The smallest times read as themselves, not as the first bin edge.
    const quick = seatsMod.createGateStats({ now: () => t });
    quick.firstByte(120); quick.firstByte(80);
    assert.equal(quick.view().lastHour.ttfbP95Ms, 120);
});

test('seat gate: counts what people met — 401, 429, let in, stopped before/after the first word, the wait for it — never who (plan 3.3)', async () => {
    const http = require('http');
    const net = require('net');
    const canBind = await new Promise((r) => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(0, '127.0.0.2', () => s.close(() => r(true))); });
    let upClosed = 0;
    const upstream = http.createServer((req, res) => {
        req.resume();
        res.on('close', () => { upClosed++; });
        const mode = req.headers['x-test'];
        if (mode === 'json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"choices":[]}'); }
        if (mode === 'hang') return;                                      // queued forever: no first byte
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (mode === 'drip') return res.write('data: one\n\n');          // a first word, then nothing
        setTimeout(() => { res.write('data: hello\n\n'); res.end('data: [DONE]\n\n'); }, 300);
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    const seats = seatsMod.createSeats({ capacity: () => 1, idleReleaseSec: () => 900 });
    const real = seatsMod.createGateStats();
    const args = [];   // every value the gate ever hands the stats
    const stats = new Proxy(real, { get: (o, k) => (typeof o[k] === 'function' ? (...a) => { args.push(...a); return o[k](...a); } : o[k]) });
    const gate = await seatsMod.startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: upstream.address().port, seats, idleReleaseSec: () => 900, password: () => 'pw', stats });
    const call = (mode, { key = 'pw', from, abortOn } = {}) => new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1', port: gate.address().port, method: 'POST', path: '/v1/chat/completions', localAddress: from,
            headers: { 'content-type': 'application/json', 'x-test': mode, ...(key ? { authorization: `Bearer ${key}` } : {}) },
        }, (res) => {
            let buf = '';
            res.on('data', (c) => { buf += c; if (abortOn === 'first') req.destroy(); });
            res.on('end', () => resolve({ status: res.statusCode, body: buf }));
            res.on('close', () => resolve({ status: res.statusCode, body: buf }));
        });
        req.on('error', () => resolve({ status: 0 }));
        if (abortOn === 'wait') setTimeout(() => req.destroy(), 150);
        req.end('{"messages":[]}');
    });
    const hour = () => real.view().lastHour;
    try {
        assert.equal((await call('stream', { key: null })).status, 401);
        assert.equal((await call('stream')).status, 200);
        assert.equal((await call('json')).status, 200);
        assert.deepEqual([hour().unauthorized, hour().admitted, hour().timed], [1, 2, 1], 'a non-streamed reply is let in but not timed');
        assert.ok(hour().ttfbMaxMs >= 280 && hour().ttfbP50Ms <= 500 && hour().ttfbP50Ms >= 280, JSON.stringify(hour()));
        await call('hang', { abortOn: 'wait' });
        await waitFor(() => hour().cancelled === 1, 2000, 'a cancel before the first word');
        await call('drip', { abortOn: 'first' });
        await waitFor(() => hour().cancelled === 2, 2000, 'a cancel after the first word');
        assert.deepEqual([hour().cancelledBeforeFirstByte, hour().timed, hour().admitted], [1, 2, 4]);
        await waitFor(() => upClosed >= 4, 2000, 'both stopped requests to reach the upstream');
        if (canBind) {
            assert.equal((await call('stream', { from: '127.0.0.2' })).status, 429, 'a second address on a one-seat farm');
            assert.deepEqual([hour().refused, hour().peakSeats, hour().peakOf], [1, 1, 1]);
        } else console.log('       (429 part skipped: this OS only routes 127.0.0.1)');
        const before = JSON.stringify(real.view());
        await new Promise((r) => http.get(`http://127.0.0.1:${gate.address().port}/v1/models`, (res) => { res.resume(); res.on('end', r); }));
        assert.equal(JSON.stringify(real.view()), before, 'GET /v1/models counts nothing');
        // Never who: the hooks only ever receive numbers and booleans, and the whole state holds no address.
        assert.ok(args.every((a) => typeof a === 'number' || typeof a === 'boolean'), JSON.stringify(args));
        assert.ok(!/127\.0\.0|::1|ffff/.test(JSON.stringify({ m: real.minutes, t: real.total, v: real.view() })), 'no address anywhere in the state');
    } finally {
        gate.close();
        upstream.close();
    }
});

test('panel: the Clients card shows what people met at the gate, and its headline says how many were turned away', () => {
    const render = loadPanel();
    const at = new Date(2026, 9, 4, 14, 5).getTime();
    const realNow = Date.now;
    Date.now = () => at + 10 * 60000;
    try {
        const zero = { admitted: 0, refused: 0, unauthorized: 0, cancelled: 0, cancelledBeforeFirstByte: 0, peakSeats: 0, peakAt: null, peakOf: null, timed: 0, ttfbP50Ms: null, ttfbP95Ms: null, ttfbMaxMs: null };
        const hourStats = { ...zero, admitted: 42, refused: 3, cancelled: 2, cancelledBeforeFirstByte: 1, peakSeats: 3, peakAt: at, peakOf: 3, timed: 40, ttfbP50Ms: 1000, ttfbP95Ms: 3000 };
        const html = render(adminState({ capacity: { slots: 3, clients: 0, seats: [], seatIdleSec: 900, slotsVerified: true, unmanagedHosts: [],
            metrics: { startedAt: at - 3600e3, lastHour: hourStats, sinceStart: { ...hourStats, admitted: 120, refused: 5 } } } }));
        assert.ok(html.includes('· 3 generations turned away in the last hour'), 'the headline, readable with the card folded');
        for (const s of ['42 generations let in', '3 turned away (all seats in use)', '2 stopped before the end (1 before the first word)',
            'fullest: 3 of 3 seats at', 'first word within 1 s for half, 3 s for 95%', '120 generations let in', 'never per person']) {
            assert.ok(html.includes(s), s);
        }
        assert.ok(!html.includes('wrong password'), 'a zero count stays out of the sentence');
        const quiet = render(adminState({ capacity: { slots: 3, clients: 0, seats: [], seatIdleSec: 900, slotsVerified: true, unmanagedHosts: [],
            metrics: { startedAt: at, lastHour: zero, sinceStart: zero } } }));
        assert.ok(!quiet.includes('turned away in the last hour') && quiet.includes('0 generations let in'), 'nobody turned away: no headline');
        assert.ok(!render(adminState()).includes('Last hour'), 'an old farm or the gate off: no line at all');
    } finally {
        Date.now = realNow;
    }
});

test('lol bench --people simulates PEOPLE: one source address each, so the real gate turns the one too many away; --cancel stops streams; --out saves it all (plan 0.5)', async () => {
    const http = require('http');
    const net = require('net');
    const canBind = await new Promise((r) => { const s = net.createServer(); s.once('error', () => r(false)); s.listen(0, '127.0.0.2', () => s.close(() => r(true))); });
    if (!canBind) { console.log('       (skipped: this OS only routes 127.0.0.1 — macOS needs `ifconfig lo0 alias`)'); return; }
    let aborted = 0;
    const upstream = http.createServer((req, res) => {   // a mock LiteLLM: 10 tokens, 30 ms apart
        req.resume();
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        let n = 0;
        const t = setInterval(() => {
            if (++n <= 10) return res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `t${n} ` } }] })}\n\n`);
            clearInterval(t);
            res.end(`data: ${JSON.stringify({ choices: [], usage: { completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`);
        }, 30);
        res.on('close', () => { clearInterval(t); if (!res.writableEnded) aborted++; });
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    const bench = require('../src/commands/bench');
    const out = path.join(os.tmpdir(), `lol-bench-test-${process.pid}.json`);
    const quietly = async (fn) => { const { log: l, warn: w } = console; console.log = console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.warn = w; } };
    const benchAgainst = async (capacity, extra) => {
        const seats = seatsMod.createSeats({ capacity: () => capacity, idleReleaseSec: () => 900 });
        const gate = await seatsMod.startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: upstream.address().port, seats, idleReleaseSec: () => 900 });
        try {
            const code = await quietly(() => bench.run(['--people', '--users', '4', '--rounds', '1', '--url', `http://127.0.0.1:${gate.address().port}`, '--model', 'fake', '--max-tokens', '10', '--out', out, ...extra]));
            return { code, seated: seats.view().map((s) => s.ip), saved: JSON.parse(fs.readFileSync(out, 'utf8')) };
        } finally { gate.close(); }
    };
    try {
        const full = await benchAgainst(3, []);
        assert.equal(full.code, 0);
        assert.equal(full.saved.sources, 'per-user');
        assert.deepEqual(full.saved.requests.map((x) => x.source).sort(), ['127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.5']);
        assert.equal(full.saved.summary.refused, 1, 'four people, three seats → exactly one 429');
        assert.equal(full.saved.summary.ok, 3);
        assert.equal(new Set(full.seated).size, 3, 'three distinct people hold the three seats');
        assert.equal(full.saved.requests.find((x) => x.status === 429).tokens, undefined, 'the refused one got nothing');
        const stop = await benchAgainst(4, ['--cancel', '0.5']);
        assert.deepEqual([stop.saved.summary.ok, stop.saved.summary.cancelled, stop.saved.summary.refused], [4, 2, 0]);
        assert.equal(stop.saved.requests.filter((x) => x.cancelled).every((x) => x.tokens === 5), true, 'stopped half-way (max-tokens 10)');
        await waitFor(() => aborted === 2, 2000, 'the upstream to see two streams stop');
        assert.equal(stop.saved.summary.tpsMedian > 0, true);
    } finally {
        upstream.close();
        try { fs.unlinkSync(out); } catch { /* none */ }
    }
});

// ---- docs review 2026-09-27 (FA-1 … FA-9) ------------------------------------

// The admin panel's own script, run against a DOM stub: render(state) returns the
// HTML it would put on screen. Every handler is wired onto inert stubs, so this
// exercises exactly what an operator would SEE for a given /lol/admin/state.
// `fetch` and `confirm` can be stubbed, for a test that clicks a button and reads what the panel asked and sent.
function loadPanel({ fetch: fetchFn = () => new Promise(() => {}), confirm: confirmFn = () => false } = {}) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
    const m = /<script>([\s\S]*)<\/script>/.exec(html);
    assert.ok(m, 'panel script block moved — update loadPanel');
    const els = new Map();
    const el = (sel) => {
        if (!els.has(sel)) {
            els.set(sel, {
                innerHTML: '', value: '', dataset: {}, style: {},
                classList: { add() {}, remove() {} },
                querySelector: (s) => el(`${sel} ${s}`), querySelectorAll: () => [],
                addEventListener() {}, focus() {}, select() {},
            });
        }
        return els.get(sel);
    };
    const scrolled = [];   // what the page scrolled into view (getElementById answers from the rendered HTML)
    const document = { querySelector: el, activeElement: null,
        getElementById: (id) => (el('#app').innerHTML.includes(`id="${id}"`) ? { scrollIntoView: () => scrolled.push(id) } : null) };
    const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    // eslint-disable-next-line no-new-func
    const fn = new Function('document', 'localStorage', 'setInterval', 'fetch', 'confirm', 'matchMedia',
        `${m[1]}\n;return { render, switchConfirm: typeof switchConfirm === 'function' ? switchConfirm : () => '', engineClick: typeof engineClick === 'function' ? engineClick : null };`);
    const out = fn(document, localStorage, () => 0, fetchFn, confirmFn, () => ({ matches: false }));
    const render = (state) => { out.render(state); return el('#app').innerHTML; };
    render.el = el;   // the stubs, for a test that edits a control after render
    render.switchConfirm = out.switchConfirm;
    render.engineClick = out.engineClick;   // an engine button's press (the stubs wire no clicks)
    render.scrolled = scrolled;
    return render;
}

function adminState(over = {}) {
    return {
        name: 'Test Farm',
        backend: { engine: 'ollama', alias: 'gemma4:12b', model: 'gemma4:12b', contextLength: 32768, contextPerSlot: 32768, contextAuto: true, slots: 2, slotsVerified: true },
        llamacpp: { enabled: false, running: false, alias: 'assistant', library: [], contextLength: 'auto', contextResolved: null, parallel: 1 },
        ollama: { hosts: ['http://127.0.0.1:11434'], numParallel: 2, contextLength: 'auto', contextResolved: 32768, nativeMax: 262144 },
        capacity: { slots: 2, clients: 0, seats: [], seatIdleSec: 900, slotsVerified: true, unmanagedHosts: [], ollamaEnvAdvice: null },
        models: [
            { id: 'gemma4:12b', size: 8e9, served: true, loaded: true, isDefault: true, servedAs: 'gemma4:12b' },
            { id: 'qwen3:8b', size: 5e9, served: true, loaded: false, isDefault: false, servedAs: 'qwen3:8b' },
            { id: 'llava:7b', size: 4e9, served: false, loaded: false, isDefault: false, servedAs: null },
        ],
        plugins: {}, recommendedClientPlugins: [], clients: [],
        health: { hostsUp: 1, hostsTotal: 1, proxyUp: true, gpu: null, host: null },
        requiresKey: false, job: null, perf: null, perfHistory: [], fit: null,
        ocrModel: 'gemma4:12b', llamacppAvailable: true, llamacppBootError: null,
        ...over,
    };
}

const { ollamaServes, carryNameAcross, applyNamePlan, engineFallback } = require('../src/litellm');

test('ollamaServes: only when neither llama.cpp nor an external server serves (FA-1)', () => {
    const c = defaultConfig();
    assert.equal(ollamaServes(c), true, 'the default farm serves on Ollama');
    c.llamacpp.enabled = true;
    assert.equal(ollamaServes(c), false);
    c.llamacpp.enabled = false; c.external.enabled = true;
    assert.equal(ollamaServes(c), false, 'external boot sets llamacpp.enabled=false — that must NOT read as "Ollama serves"');
    // The routing agrees with the helper: no Ollama deployment while external serves.
    assert.ok(buildLitellmConfig(c).model_list.every((d) => !String(d.litellm_params.model).startsWith('ollama')));
});

test('panel: an external server leaves no Ollama/capacity/context control live (FA-1)', () => {
    const render = loadPanel();
    // Sanity: on the Ollama engine the controls ARE there (so the negative check below bites).
    const ol = render(adminState());
    for (const needle of ['id="ctx-sel"', 'id="slots-sel"', 'data-act=', 'data-dact=']) assert.ok(ol.includes(needle), `ollama view lost ${needle}`);

    const ext = render(adminState({
        backend: { engine: 'external', alias: 'assistant', model: 'deepseek-v4', baseUrl: 'http://10.0.0.5:8000/v1', contextLength: 32768, contextPerSlot: 32768, contextAuto: false, slots: 4, slotsVerified: false },
        capacity: { slots: 4, clients: 0, seats: [], seatIdleSec: 900, slotsVerified: false, unmanagedHosts: [], ollamaEnvAdvice: null },
    }));
    for (const needle of ['id="ctx-sel"', 'id="slots-sel"', 'data-act=', 'data-dact=']) {
        assert.ok(!ext.includes(needle), `external view must not render ${needle}`);
    }
    assert.ok(!ext.includes('These are what this farm serves'), 'the Ollama catalog is standby, not served');
    assert.ok(/External server<\/b>|External server is serving/.test(ext), 'the standby hint names the engine that serves');
    assert.ok(ext.includes('id="sec-in"') && ext.includes('id="settings-apply"'), 'the farm password still applies (it gates the farm proxy)');
});

test('panel: llama.cpp standby hides Offer/Default, and Rename on the default row', () => {
    const render = loadPanel();
    const out = render(adminState({
        backend: { engine: 'llama.cpp', alias: 'assistant', model: 'Qwen3.8-27B-UD-IQ2_S', contextLength: 65536, contextPerSlot: 65536, contextAuto: true, kvUnified: true, slots: 1, slotsVerified: true },
        llamacpp: { enabled: true, running: true, alias: 'assistant', library: [], contextLength: 'auto', contextResolved: 65536, parallel: 1 },
    }));
    assert.ok(!out.includes('data-act=') && !out.includes('data-dact='));
    assert.ok(!out.includes('data-rn="gemma4:12b"'), 'the default takes llama.cpp\'s name on a switch back — no dead Rename');
    assert.ok(out.includes('data-rn="qwen3:8b"'), 'other standby rows can still be named');
    assert.ok(out.includes('llama.cpp is serving'));
});

test('panel: Ollama "people served at once" shows and sends the PER-BOX value (FA-9)', () => {
    const render = loadPanel();
    const out = render(adminState({
        backend: { engine: 'ollama', alias: 'gemma4:12b', model: 'gemma4:12b', contextLength: 32768, contextPerSlot: 32768, contextAuto: true, slots: 4, slotsVerified: true },
        ollama: { hosts: ['http://a:11434', 'http://b:11434'], numParallel: 2, contextLength: 'auto', contextResolved: 32768, nativeMax: 262144 },
        capacity: { slots: 4, clients: 0, seats: [], seatIdleSec: 900, slotsVerified: true, unmanagedHosts: [], ollamaEnvAdvice: null },
    }));
    const sel = /<select id="slots-sel" data-orig="(\d+)">([\s\S]*?)<\/select>/.exec(out);
    assert.ok(sel, 'slots select rendered');
    assert.equal(sel[1], '2', 'compared against numParallel, the value Apply writes');
    const chosen = /<option value="(\d+)" selected>/.exec(sel[2]);
    assert.equal(chosen && chosen[1], '2', '2 hosts × 2 must show 2 per box, not the total 4');
    assert.ok(out.includes('People served at once, per box'));
    assert.ok(out.includes('4 across the farm now'), 'the farm total is still stated');
});

test('an engine switch carries the served name both ways, per-model alias included (FA-2)', () => {
    const defId = (c) => buildSnapshot(c, {}).models.find((m) => m.default).id;
    const switchTo = (c, toLc) => {
        const snapshotBefore = JSON.stringify(c);
        const plan = carryNameAcross(c, toLc ? 'ollama' : 'llamacpp', toLc ? 'llamacpp' : 'ollama');
        assert.equal(JSON.stringify(c), snapshotBefore, 'carryNameAcross is pure — it only returns a plan');
        applyNamePlan(c, plan);
        c.llamacpp.enabled = toLc;
        return plan;
    };

    // Renamed per row on Ollama (the only way the panel names an Ollama model).
    let c = defaultConfig();
    c.models = [{ id: 'gemma4:12b', default: true, alias: 'tutor' }, { id: 'qwen3:8b' }];
    let before = defId(c);
    assert.equal(before, 'tutor');
    switchTo(c, true);
    assert.equal(defId(c), before, 'Ollama → llama.cpp keeps "tutor"');
    // Renamed on llama.cpp, then back: the default's own alias takes the new name.
    c.llamacpp.alias = 'coach';
    before = defId(c);
    switchTo(c, false);
    assert.equal(defId(c), before, 'llama.cpp → Ollama keeps "coach"');
    assert.equal(c.models[0].alias, 'coach', 'written onto the own alias (it outranks modelAlias)');

    // The global modelAlias path.
    c = defaultConfig();
    c.modelAlias = 'helper';
    before = defId(c);
    switchTo(c, true);
    assert.equal(defId(c), before);
    assert.equal(c.modelAlias, null, 'llamacpp.alias is the single source of truth while llama.cpp serves');
    before = defId(c);
    switchTo(c, false);
    assert.equal(defId(c), before);

    // A raw checkpoint id is not carried to llama.cpp; coming back, llama.cpp's name is.
    c = defaultConfig();
    c.llamacpp.enabled = true;
    before = defId(c);
    assert.equal(before, 'assistant');
    switchTo(c, false);
    assert.equal(defId(c), 'assistant');

    // Never creates a duplicate route: another model already named like llama.cpp.
    c = defaultConfig();
    c.llamacpp.enabled = true;
    c.models = [{ id: 'gemma4:12b', default: true }, { id: 'qwen3:8b', alias: 'assistant' }];
    assert.deepEqual(carryNameAcross(c, 'llamacpp', 'ollama'), {}, 'skip rather than merge two models into one name');
});

test('a fallback serves the name chats are bound to, in memory only (FA-3)', () => {
    const snapId = (c) => buildSnapshot(c, {}).models.find((m) => m.default).id;
    // No prebuilt / start failure / second crash: llama.cpp → Ollama.
    let c = defaultConfig();
    c.llamacpp.enabled = true; c.modelAlias = null;
    const plan = engineFallback(c, 'llamacpp');
    assert.equal(c.llamacpp.enabled, false);
    assert.equal(snapId(c), 'assistant', 'not the raw gemma4:12b');
    assert.deepEqual(plan, { modelAlias: 'assistant' });
    // The operator's own Ollama name wins over the engine alias.
    c = defaultConfig();
    c.llamacpp.enabled = true;
    c.models = [{ id: 'gemma4:12b', default: true, alias: 'tutor' }];
    assert.deepEqual(engineFallback(c, 'llamacpp'), {});
    assert.equal(snapId(c), 'tutor');
    // External down at boot, Ollama stands in → under the external alias.
    c = defaultConfig();
    c.external.enabled = true; c.external.alias = 'deepseek';
    engineFallback(c, 'external');
    assert.equal(c.external.enabled, false);
    assert.equal(snapId(c), 'deepseek');
    // External down, llama.cpp stands in → under the external alias; if llama.cpp
    // then fails too, Ollama still answers to it.
    c = defaultConfig();
    c.external.enabled = true; c.external.alias = 'deepseek'; c.llamacpp.enabled = true;
    engineFallback(c, 'external');
    assert.equal(snapId(c), 'deepseek');
    engineFallback(c, 'llamacpp');
    assert.equal(snapId(c), 'deepseek');
    // engineFallback takes a config object, never a path: it cannot write the file.
    assert.equal(engineFallback.length, 2);
});

test('private farm: plugins bind loopback and advertise loopback URLs (FA-4)', () => {
    const { serviceHosts, primaryAddress } = require('../src/net');
    const searxngMod = require('../src/searxng');
    const extractMod = require('../src/extract');
    const kokoroMod = require('../src/kokoro');
    const spy = () => {
        const calls = [];
        const fn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { pid: null, on() {}, stdout: null, stderr: null }; };
        fn.calls = calls;
        return fn;
    };
    const hostArg = (args) => args[args.indexOf('--host') + 1];
    for (const [proxyHost, want] of [['127.0.0.1', '127.0.0.1'], ['localhost', '127.0.0.1'], ['0.0.0.0', '0.0.0.0'], ['10.1.2.3', '10.1.2.3']]) {
        const c = defaultConfig();
        c.proxy.host = proxyHost;
        const s1 = spy(); searxngMod.spawnSearxng(c, s1);
        assert.equal(s1.calls[0].opts.env.SEARXNG_BIND_ADDRESS, want, `searxng on proxy.host=${proxyHost}`);
        const s2 = spy(); extractMod.spawnExtract(c, { key: 'k', model: 'm', ollamaUrl: 'http://127.0.0.1:11434/api/generate' }, s2);
        assert.equal(hostArg(s2.calls[0].args), want, `ocr on proxy.host=${proxyHost}`);
        const s3 = spy(); kokoroMod.spawnKokoro(c, { spawnFn: s3, espeak: '' });
        assert.equal(hostArg(s3.calls[0].args), want, `kokoro on proxy.host=${proxyHost}`);
    }
    // The farm's own health probes reach a specifically-bound plugin where it is.
    assert.equal(serviceHosts('10.1.2.3').probe, '10.1.2.3');
    assert.equal(serviceHosts('0.0.0.0').probe, '127.0.0.1');
    // Private: the same-box client reads /lol/self over loopback and must be sent to
    // loopback — the LAN address would point it at ports nothing listens on.
    const c = defaultConfig();
    c.proxy.host = '127.0.0.1'; c.tts.enabled = true;
    const h = { searxngUp: true, ttsUp: true, extractUp: true, extractKey: 'k' };
    let snap = buildSnapshot(c, h);
    assert.equal(snap.searxngUrl, 'http://127.0.0.1:8888');
    assert.equal(snap.ttsUrl, 'http://127.0.0.1:8880/v1');
    assert.equal(snap.extract.url, 'http://127.0.0.1:8890');
    // Shared: unchanged — the primary LAN address.
    c.proxy.host = '0.0.0.0';
    snap = buildSnapshot(c, h);
    assert.equal(snap.searxngUrl, `http://${primaryAddress()}:8888`);
    assert.equal(snap.extract.url, `http://${primaryAddress()}:8890`);
});

test('standby catalog edits leave the routing byte-identical (FA-5 no-restart guard)', () => {
    for (const engine of ['llamacpp', 'external']) {
        const c = defaultConfig();
        if (engine === 'llamacpp') c.llamacpp.enabled = true; else c.external.enabled = true;
        const before = toYaml(buildLitellmConfig(c));
        c.models = c.models.concat([{ id: 'qwen3:8b' }]);
        c.models = c.models.map((m) => ({ ...m, default: m.id === 'qwen3:8b' }));
        assert.equal(toYaml(buildLitellmConfig(c)), before, `${engine}: a pulled/default-changed standby model must not need a proxy restart`);
        assert.equal(ollamaServes(c), false);
    }
});

test('the farm advertises the Farm app release, not farm/package.json (FA-6)', () => {
    const { PKG_VERSION } = require('../src/snapshot');
    const prev = process.env.LOL_FARM_VERSION;
    try {
        process.env.LOL_FARM_VERSION = '0.0.39';
        assert.equal(buildSnapshot(defaultConfig(), {}).version, '0.0.39');
        delete process.env.LOL_FARM_VERSION;
        assert.equal(buildSnapshot(defaultConfig(), {}).version, PKG_VERSION, 'a bare CLI checkout falls back to package.json');
    } finally {
        if (prev === undefined) delete process.env.LOL_FARM_VERSION; else process.env.LOL_FARM_VERSION = prev;
    }
});

test('lol models add/rm patch only `models`, never the parsed defaults (FA-7)', () => {
    const modelsCmd = require('../src/commands/models');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-models-'));
    const p = path.join(dir, 'lol.config.json');
    const read = () => JSON.parse(fs.readFileSync(p, 'utf8'));
    try {
        fs.writeFileSync(p, JSON.stringify({ models: [{ id: 'gemma4:12b', default: true }] }));
        assert.equal(modelsCmd.add('qwen3:8b', p), 0);
        assert.deepEqual(Object.keys(read()), ['models'], 'no default may be frozen into the file');
        assert.deepEqual(read().models.map((m) => m.id), ['gemma4:12b', 'qwen3:8b']);
        assert.equal(modelsCmd.remove('qwen3:8b', p), 0);
        assert.deepEqual(Object.keys(read()), ['models']);
        assert.deepEqual(read().models.map((m) => m.id), ['gemma4:12b']);
        // A file with no catalog: add keeps the default catalog it was serving.
        fs.writeFileSync(p, JSON.stringify({ name: 'X' }));
        assert.equal(modelsCmd.add('qwen3:8b', p), 0);
        assert.deepEqual(Object.keys(read()).sort(), ['models', 'name']);
        assert.deepEqual(read().models.map((m) => m.id), ['gemma4:12b', 'qwen3:8b']);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('deriving a source model never ships num_ctx:"auto" (FA-8)', () => {
    const c = defaultConfig();   // ollama.contextLength = 'auto'
    const m = { id: 'mine', source: 'hf.co/unsloth/X-GGUF:Q4_K_M' };
    const p = ollama.deriveParams(c, m);
    assert.ok(!Object.values(p).includes('auto'), 'the string must never reach /api/create');
    assert.ok(!('num_ctx' in p), 'the routed per-request num_ctx governs instead');
    c.ollama.contextLength = 32768;
    assert.equal(ollama.deriveParams(c, m).num_ctx, 32768, 'a pinned number still bakes in');
    assert.equal(ollama.deriveParams(c, { ...m, params: { num_ctx: 8192 } }).num_ctx, 8192, "the entry's own num_ctx wins");
    assert.equal(ollama.deriveParams(defaultConfig(), defaultConfig().preinstall[0]).num_ctx, 8192);
});

test('pressure eviction covers any non-Ollama engine (external too)', () => {
    const base = { vramUsedGb: 11.5, vramTotalGb: 12, gpuUtil: 3, loadedCount: 1 };
    assert.equal(perfMod.shouldEvictOllama({ ...base, otherEngineOn: true }), true);
    assert.equal(perfMod.shouldEvictOllama({ ...base, otherEngineOn: false }), false);
    assert.equal(perfMod.shouldEvictOllama({ ...base, llamacppOn: true }), true, 'the older name still works');
});

test('stt plugin: faster-whisper pinned (no torch), bound like the others, key and model in env, advertised only when up (plan v2 §3.3)', () => {
    const sttMod = require('../src/stt');
    assert.match(sttMod.depsSignature(), /faster-whisper=1\.2\.1/, 'the version Open WebUI pins');
    const c = defaultConfig();
    assert.deepEqual([c.stt.enabled, c.stt.port, c.stt.model, c.stt.threads, c.stt.maxMb], [false, 8892, 'small', 4, 25]);
    for (const [proxyHost, want] of [['127.0.0.1', '127.0.0.1'], ['0.0.0.0', '0.0.0.0']]) {
        c.proxy.host = proxyHost;
        const calls = [];
        sttMod.spawnStt(c, { key: 'kk' }, (cmd, args, opts) => { calls.push({ args, opts }); return { pid: null, on() {} }; });
        assert.equal(calls[0].args[calls[0].args.indexOf('--host') + 1], want, `stt on proxy.host=${proxyHost}`);
        assert.ok(calls[0].args.includes('--no-access-log'));
        assert.equal(calls[0].opts.env.STT_API_KEY, 'kk');
        assert.equal(calls[0].opts.env.STT_MODEL, 'small');
    }
    const on = defaultConfig(); on.stt.enabled = true;
    assert.equal(buildSnapshot(on, { proxyUp: true, hostsUp: 1 }).stt, null, 'not advertised until it is up');
    assert.match(buildSnapshot(on, { proxyUp: true, hostsUp: 1, sttUp: true, sttKey: 'kk' }).stt.url, /:8892$/);
    assert.equal(buildSnapshot(defaultConfig(), { proxyUp: true, hostsUp: 1, sttUp: true, sttKey: 'kk' }).stt, null, 'off in the config: never advertised');
});

test('classify plugin: pinned CPU install, bound like the others, key in env, advertised only when up (plan v2 §3.2)', () => {
    const classifyMod = require('../src/classify');
    assert.match(classifyMod.depsSignature(), /laya=0\.3\.20/, 'Laya pinned');
    assert.match(classifyMod.depsSignature(), /torch=cpu/, 'torch from the CPU index');
    const c = defaultConfig();
    assert.deepEqual([c.classify.enabled, c.classify.port, c.classify.threads, c.classify.maxItems], [false, 8891, 4, 200]);
    for (const [proxyHost, want] of [['127.0.0.1', '127.0.0.1'], ['0.0.0.0', '0.0.0.0']]) {
        c.proxy.host = proxyHost;
        const calls = [];
        classifyMod.spawnClassify(c, { key: 'kk' }, (cmd, args, opts) => { calls.push({ args, opts }); return { pid: null, on() {} }; });
        assert.equal(calls[0].args[calls[0].args.indexOf('--host') + 1], want, `classify on proxy.host=${proxyHost}`);
        assert.ok(calls[0].args.includes('--no-access-log'), 'no request lines in the log');
        assert.equal(calls[0].opts.env.CLASSIFY_API_KEY, 'kk');
        assert.equal(calls[0].opts.env.CLASSIFY_THREADS, '4');
    }
    const on = defaultConfig(); on.classify.enabled = true;
    assert.equal(buildSnapshot(on, { proxyUp: true, hostsUp: 1 }).classify, null, 'not advertised until it is up');
    const snap = buildSnapshot(on, { proxyUp: true, hostsUp: 1, classifyUp: true, classifyKey: 'kk' });
    assert.deepEqual(Object.keys(snap.classify).sort(), ['key', 'url']);
    assert.match(snap.classify.url, /:8891$/);
    assert.equal(buildSnapshot(defaultConfig(), { proxyUp: true, hostsUp: 1, classifyUp: true, classifyKey: 'kk' }).classify, null, 'off in the config: never advertised');
});

test('plugin keys are tied to the farm password: off the beacon when one is set, served to its holder only', async () => {
    const health = { proxyUp: true, hostsUp: 1, extractUp: true, extractKey: 'ek', classifyUp: true, classifyKey: 'ck', sttUp: true, sttKey: 'sk' };
    const open = defaultConfig(); open.classify.enabled = true; open.stt.enabled = true;
    const snapOpen = buildSnapshot(open, health);
    assert.deepEqual([snapOpen.extract.key, snapOpen.classify.key, snapOpen.stt.key], ['ek', 'ck', 'sk'], 'an open farm: the keys ride the snapshot as before');
    const keyed = defaultConfig(); keyed.classify.enabled = true; keyed.stt.enabled = true; keyed.proxy.masterKey = 'pw';
    const snapKeyed = buildSnapshot(keyed, health);
    assert.deepEqual([snapKeyed.extract.key, snapKeyed.classify.key, snapKeyed.stt.key], [null, null, null], 'a password: no key in clear');
    assert.match(snapKeyed.classify.keyId, /^[0-9a-f]{8}$/, 'a short non-secret id, so a client sees a new key');
    assert.notEqual(buildSnapshot(keyed, { ...health, classifyKey: 'ck2' }).classify.keyId, snapKeyed.classify.keyId, 'a new key changes it');
    assert.equal(snapOpen.classify.keyId, undefined, 'an open farm has the key itself');
    assert.ok(snapKeyed.extract.url && snapKeyed.classify.url && snapKeyed.stt.url, 'the services are still advertised');
    assert.ok(!JSON.stringify(snapKeyed).includes('"ek"'), 'nowhere in the snapshot');

    let password = 'pw';
    const server = startSelfServer({ httpPort: 0, getSnapshot: () => ({}), host: '127.0.0.1', getPluginKeys: () => ({ password, keys: { extract: 'ek', classify: 'ck', stt: null } }) });
    await new Promise((r) => { if (server.listening) r(); else server.once('listening', r); });
    const url = `http://127.0.0.1:${server.address().port}/lol/plugin-keys`;
    try {
        assert.equal((await fetch(url)).status, 401, 'no password → 401');
        assert.equal((await fetch(url, { headers: { authorization: 'Bearer nope' } })).status, 401, 'wrong password → 401');
        const ok = await fetch(url, { headers: { authorization: 'Bearer pw' } });
        assert.equal(ok.status, 200);
        assert.deepEqual(await ok.json(), { extract: 'ek', classify: 'ck', stt: null });
        password = 'rotated';
        assert.equal((await fetch(url, { headers: { authorization: 'Bearer pw' } })).status, 401, 'a changed password takes effect at once');
        password = null;
        assert.equal((await fetch(url, { headers: { authorization: 'Bearer pw' } })).status, 404, 'an open farm: the keys are in /lol/self');
    } finally { server.close(); }
});

test('plugin keys survive a farm restart, so no client restarts its Open WebUI (plan 0.3)', () => {
    const { pluginKey } = require('../src/identity');
    const file = path.join(os.tmpdir(), `lol-secret-test-${process.pid}`);
    try { fs.unlinkSync(file); } catch { /* fresh */ }
    const rt = { pluginKey: (id, pw) => pluginKey(id, pw, file), resolveOcrModel: () => 'gemma4:12b', isLocalHost: () => true, reachable: ['http://127.0.0.1:11434'] };
    const start = (password = null) => {
        const c = defaultConfig(); c.proxy.masterKey = password;
        return Object.fromEntries(makeServices().filter((s) => ['ocr', 'classify', 'stt'].includes(s.id))
            .map((s) => [s.id, s.desc.makeCtx(c, rt).key]));
    };
    try {
        const first = start();
        const second = start();   // the next `lol up`: a new process reads the same file
        assert.deepEqual(second, first, 'the same key for each plugin across starts');
        assert.equal(new Set(Object.values(first)).size, 3, 'one key per plugin');
        for (const k of Object.values(first)) assert.match(k, /^[0-9a-f]{48}$/);
        const keyed = defaultConfig(); keyed.proxy.masterKey = 'pw';
        const keyId = (k) => buildSnapshot(keyed, { proxyUp: true, hostsUp: 1, extractUp: true, extractKey: k }).extract.keyId;
        assert.deepEqual(start('pw'), start('pw'), 'with a password too, the same keys on every start');
        assert.equal(keyId(start('pw').ocr), keyId(start('pw').ocr), 'keyId stays put, so clients do not refetch');
        // A password set or changed gives new keys at the next start (review 2026-10-07): a device that read the
        // keys from the beacon while the farm was open, or that knew the old password, loses the plugins.
        const set = start('pw');
        const changed = start('pw2');
        for (const id of ['ocr', 'classify', 'stt']) {
            assert.notEqual(set[id], first[id], `${id}: setting a password rotates it`);
            assert.notEqual(changed[id], set[id], `${id}: changing it rotates it again`);
        }
        assert.notEqual(keyId(changed.ocr), keyId(set.ocr), 'and keyId changes, so a client holding the new password fetches again');
        assert.deepEqual(start(), first, 'back to no password: the open farm\'s keys');
        // An open farm keeps farm-v0.0.41's keys at the upgrade: no restart wave across the clients.
        const secret = fs.readFileSync(file, 'utf8').trim();
        assert.equal(first.ocr, require('crypto').createHmac('sha256', secret).update('ocr').digest('hex').slice(0, 48), 'open farm: the v0.0.41 derivation');
        fs.unlinkSync(file);
        assert.notEqual(start().ocr, first.ocr, 'deleting the secret rotates the keys');
    } finally { try { fs.unlinkSync(file); } catch { /* gone */ } }
});

test('panel: the password row says what it protects — the plugins too — and that old plugin access lasts until the farm restarts (review 2026-10-07)', () => {
    const render = loadPanel();
    const set = render(adminState({ requiresKey: true }));
    assert.ok(set.includes('Protects chat (everything on /v1), document reading, Classify, speech to text and the message bus.'), 'what it protects');
    assert.ok(set.includes('Web search, voice and discovery stay open on the LAN.'), 'what stays open');
    assert.ok(set.includes('When the password is set or changed, a device that could already use document reading, Classify or speech to text keeps them until the farm restarts.'), 'a device that had the plugins keeps them until then');
    const open = render(adminState({ requiresKey: false }));
    assert.ok(open.includes('protects chat, document reading, Classify, speech to text and the message bus; web search, voice and discovery stay open'));
    for (const html of [set, open]) assert.ok(!/document reading( and|,) discovery stay open|document reading \/ discovery/.test(html), 'no longer says document reading stays open');
});

test('classify + stt start AFTER the farm is public, and their installs never block the event loop (rig, 2026-09-27)', () => {
    const svcs = makeServices();
    assert.deepEqual(svcs.filter((s) => s.desc.late).map((s) => s.id), ['bus', 'classify', 'stt'], 'the two heavy first starts are late, and the quick bus before them');
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    const boot = upSrc.indexOf('if (!svc.enabled(config) || svc.desc.late) continue;');
    const late = upSrc.indexOf('if (!svc.desc.late || !svc.enabled(config)) continue;');
    const gate = upSrc.indexOf('seatGateServer = await startSeatGate(');
    assert.ok(boot > 0 && late > 0 && gate > 0, 'both loops and the seat gate are where they should be');
    assert.ok(boot < gate && gate < late, 'boot plugins before the seat gate; the late ones after it');
    for (const f of ['classify', 'stt']) {
        const src = fs.readFileSync(path.join(__dirname, '..', 'src', `${f}.js`), 'utf8');
        assert.ok(!/execSync/.test(src), `${f}: no execSync — a 1 GB pip install must not freeze the farm`);
        assert.ok(/await sh\(/.test(src), `${f}: the installs are awaited`);
    }
    // `lol down` from another shell stops them: their pids are recorded (again once a late one is up).
    assert.ok(/classifyPid: svcById\.classify\.pid/.test(upSrc) && /sttPid: svcById\.stt\.pid/.test(upSrc), 'recorded in the runtime');
    assert.ok(upSrc.indexOf('recordRuntime = writeRuntimeState') > 0 && /recordRuntime\(\);/.test(upSrc), 'a late plugin re-records');
    const downSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'down.js'), 'utf8');
    assert.ok(/rt\.classifyPid/.test(downSrc) && /rt\.sttPid/.test(downSrc), 'lol down stops them');
});

test('classify + stt waits: end early when the child exits or the model failed to load (critic M2)', async () => {
    const http = require('http');
    for (const mod of [require('../src/classify'), require('../src/stt')]) {
        const wait = mod.waitForClassify || mod.waitForStt;
        assert.equal(mod.loadError({ status: 503, body: '{"ready":false,"error":null}' }), null, 'still loading: keep waiting');
        assert.equal(mod.loadError({ status: 503, body: '{"ready":false,"error":"OSError: no weights"}' }), 'OSError: no weights');
        assert.equal(mod.loadError({ status: 200, body: '{"ready":true}' }), null);
        let t0 = Date.now();
        assert.deepEqual(await wait(1, 60000, '127.0.0.1', () => true), { up: false }, 'a dead child ends the wait');
        assert.ok(Date.now() - t0 < 1000);
        const srv = http.createServer((req, res) => { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"ready":false,"error":"boom"}'); });
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        try {
            t0 = Date.now();
            assert.deepEqual(await wait(srv.address().port, 60000), { up: false, error: 'boom' }, 'a load error ends the wait');
            assert.ok(Date.now() - t0 < 2000);
        } finally { srv.close(); }
    }
});

test('classify + stt services: refusals and bookkeeping; OCR vision calls take turns (plan 0.4) — stub models (farm/src/pysvc/check_services.py)', () => {
    // Needs a Python with fastapi + httpx + python-multipart: LOL_PYSVC_PYTHON, or a farm venv that has them. Skips otherwise.
    const { spawnSync } = require('child_process');
    const bin = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];
    const candidates = [process.env.LOL_PYSVC_PYTHON, ...['.classify', '.stt'].map((d) => path.join(__dirname, '..', d, 'venv', ...bin))].filter(Boolean);
    const py = candidates.find((p) => fs.existsSync(p) && spawnSync(p, ['-c', 'import fastapi, httpx, multipart']).status === 0);
    if (!py) { console.log('       (skipped: no Python with fastapi + httpx; set LOL_PYSVC_PYTHON)'); return; }
    const r = spawnSync(py, ['-W', 'ignore', path.join(__dirname, '..', 'src', 'pysvc', 'check_services.py')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 120000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ---- the message bus (src/bus.js, plan §8d P3b) ------------------------------------------------
// Real sockets on ephemeral ports (port 0), bound to 127.0.0.1 — never 1883/8893/9001.
const busMod = require('../src/bus');

const mqttStr = (s) => { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
function mqttConnectPkt(id, { user = null, pass = null, keepAlive = 60 } = {}) {
    const flags = 0x02 | (user != null ? 0x80 : 0) | (pass != null ? 0x40 : 0);
    return busMod.mqttPacket(0x10, Buffer.concat([mqttStr('MQTT'), Buffer.from([4, flags, keepAlive >> 8, keepAlive & 255]), mqttStr(id),
        user != null ? mqttStr(user) : Buffer.alloc(0), pass != null ? mqttStr(pass) : Buffer.alloc(0)]));
}
const mqttPubPkt = (topic, payload, qos = 0, pid = 1) => busMod.mqttPacket(0x30 | (qos << 1),
    Buffer.concat([mqttStr(topic), qos ? Buffer.from([pid >> 8, pid & 255]) : Buffer.alloc(0), Buffer.from(payload)]));
const pubOf = (p) => { const n = p.body.readUInt16BE(0); return { topic: p.body.toString('utf8', 2, 2 + n), payload: p.body.toString('utf8', 2 + n) }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 2000, what = 'condition') {
    const t0 = Date.now();
    while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(20); }
}

// A raw-socket MQTT client, written by hand: `next(type)` resolves with the next packet of that type.
function mqttRaw(port) {
    const net = require('net');
    return new Promise((resolve, reject) => {
        const sock = net.connect(port, '127.0.0.1');
        sock.setNoDelay(true);
        let buf = Buffer.alloc(0);
        const got = [];
        const waiters = [];
        let closed = false;
        const pump = () => {
            for (let i = 0; i < waiters.length; i++) {
                const j = got.findIndex((p) => p.type === waiters[i].type);
                if (j >= 0) { waiters[i].resolve(got.splice(j, 1)[0]); waiters.splice(i--, 1); }
            }
        };
        const parseOne = () => {
            if (buf.length < 2) return false;
            let len = 0; let mult = 1; let i = 1; let byte;
            do { if (i >= buf.length) return false; byte = buf[i++]; len += (byte & 127) * mult; mult *= 128; } while (byte & 128);
            if (buf.length < i + len) return false;
            got.push({ type: buf[0] >> 4, flags: buf[0] & 15, body: buf.subarray(i, i + len) });
            buf = buf.subarray(i + len);
            return true;
        };
        sock.on('data', (d) => { buf = Buffer.concat([buf, d]); while (parseOne()); pump(); });
        sock.on('close', () => { closed = true; });
        sock.on('error', () => {});
        const c = {
            sock, got,
            closed: () => closed,
            send: (b) => sock.write(b),
            next: (type, ms = 3000) => new Promise((res, rej) => {
                const w = { type, resolve: res };
                waiters.push(w);
                pump();
                setTimeout(() => { const k = waiters.indexOf(w); if (k >= 0) { waiters.splice(k, 1); rej(new Error(`no MQTT packet of type ${type} within ${ms} ms`)); } }, ms);
            }),
            async connect(id, opts) { sock.write(mqttConnectPkt(id, opts)); return (await c.next(2)).body[1]; },
            async sub(filter, pid = 1) {
                sock.write(busMod.mqttPacket(0x82, Buffer.concat([Buffer.from([pid >> 8, pid & 255]), mqttStr(filter), Buffer.from([0])])));
                return [...(await c.next(9)).body.subarray(2)];
            },
            end: () => sock.destroy(),
        };
        sock.once('connect', () => resolve(c));
        sock.once('error', reject);
    });
}

async function withBus(opts, fn) {
    const lines = [];
    const b = busMod.startBus({ host: '127.0.0.1', mqttPort: 0, wsPort: 0, oscPort: 0, log: (l) => lines.push(String(l)), ...opts });
    const ports = await b.ready;
    try { await fn(ports, b, lines); } finally { await b.close(); }
}

function wsOpen(url) {
    return new Promise((resolve, reject) => {
        const w = new WebSocket(url);
        w.onopen = () => resolve(w);
        w.onerror = () => reject(new Error('refused'));
    });
}
function wsNext(w, pred, ms = 3000) {
    return new Promise((resolve, reject) => {
        const h = (e) => { const m = JSON.parse(e.data); if (pred(m)) { w.removeEventListener('message', h); resolve(m); } };
        w.addEventListener('message', h);
        setTimeout(() => { w.removeEventListener('message', h); reject(new Error('no matching WebSocket message')); }, ms);
    });
}

async function udpSocket() {
    const s = require('dgram').createSocket('udp4');
    await new Promise((r) => s.bind(0, '127.0.0.1', r));
    s.got = [];
    s.on('message', (b) => { try { s.got.push(...busMod.oscDecode(b)); } catch { /* not OSC */ } });
    return s;
}

test('bus: topic filters, the payload rule, OSC encode/decode', () => {
    const m = busMod.topicMatches;
    assert.ok(m('sensors/+/light', 'sensors/esp1/light'));
    assert.ok(!m('sensors/+/light', 'sensors/esp1/temp'));
    assert.ok(!m('sensors/+/light', 'sensors/esp1/light/x'));
    assert.ok(m('sensors/#', 'sensors/esp1/light') && m('sensors/#', 'sensors'), '# is the rest AND the parent');
    assert.ok(m('#', 'a/b') && !m('#', '$SYS/x') && !m('+/x', '$SYS/x'), '$ topics stay out of wildcards');
    assert.ok(m('a/b', 'a/b') && !m('a/b', 'a/b/c') && m('+/+', 'a/b'));
    for (const f of ['a/#', '#', '+', 'a/+/b', 'a//b']) assert.ok(busMod.validFilter(f), f);
    for (const f of ['a/#/b', 'a#', 'a/b+', '', 5, null]) assert.ok(!busMod.validFilter(f), String(f));
    for (const t of ['a/+', 'a/#', '', 7]) assert.ok(!busMod.validTopic(t), String(t));
    assert.deepEqual(busMod.toData(Buffer.from('{"light":5}')), { light: 5 });
    assert.equal(busMod.toData(Buffer.from('on')), 'on', 'not JSON → the text');
    assert.equal(busMod.toPayload('on').toString(), 'on', 'a string goes to MQTT as itself');
    assert.equal(busMod.toPayload(0.5).toString(), '0.5');
    assert.equal(busMod.toPayload({ a: [1, true] }).toString(), '{"a":[1,true]}');
    assert.deepEqual(busMod.oscDecode(busMod.oscEncode('/x', [1, 0.1, 's', true, false])), [{ address: '/x', args: [1, 0.1, 's', true, false] }]);
    assert.deepEqual(busMod.oscDecode(busMod.oscEncode('/o', { light: 5 })), [{ address: '/o', args: ['{"light":5}'] }], 'an object → its JSON text');
    assert.deepEqual(busMod.oscDecode(busMod.oscEncode('/bang', null)), [{ address: '/bang', args: [] }]);
    // A bundle of two messages gives both.
    const el = (b) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
    const bundle = Buffer.concat([Buffer.from('#bundle\0'), Buffer.alloc(8), el(busMod.oscEncode('/a', 1)), el(busMod.oscEncode('/b', 'x'))]);
    assert.deepEqual(busMod.oscDecode(bundle), [{ address: '/a', args: [1] }, { address: '/b', args: ['x'] }]);
    assert.throws(() => busMod.oscDecode(Buffer.from('/x\0\0,b\0\0\0\0\0\1z\0\0\0')), /unsupported OSC type b/);
});

test('bus MQTT: + and # subscribers, QoS 1 → PUBACK, PINGREQ → PINGRESP, a packet split inside its length still parses', async () => {
    await withBus({}, async (p) => {
        const a = await mqttRaw(p.mqtt);
        const all = await mqttRaw(p.mqtt);
        const pub = await mqttRaw(p.mqtt);
        try {
            assert.equal(await a.connect('a'), 0);
            assert.equal(await all.connect('all'), 0);
            assert.equal(await pub.connect('pub'), 0);
            assert.deepEqual(await a.sub('sensors/+/light'), [0]);
            assert.deepEqual(await all.sub('sensors/#', 2), [0]);
            assert.deepEqual(await a.sub('bad/#/filter', 3), [0x80], 'an invalid filter → SUBACK failure');
            pub.send(mqttPubPkt('sensors/esp1/light', '{"light":512}'));
            assert.deepEqual(pubOf(await a.next(3)), { topic: 'sensors/esp1/light', payload: '{"light":512}' });
            assert.deepEqual(pubOf(await all.next(3)), { topic: 'sensors/esp1/light', payload: '{"light":512}' });
            // QoS 1: acknowledged with the same packet id, delivered at QoS 0.
            pub.send(mqttPubPkt('sensors/esp1/temp', '21', 1, 0x1234));
            const ack = await pub.next(4);
            assert.deepEqual([...ack.body], [0x12, 0x34]);
            const d = await all.next(3);
            assert.equal(d.flags, 0, 'delivered at QoS 0');
            assert.deepEqual(pubOf(d), { topic: 'sensors/esp1/temp', payload: '21' });
            // A 300-byte payload needs two remaining-length bytes: split the packet between them.
            const big = mqttPubPkt('sensors/esp2/light', 'x'.repeat(300));
            pub.send(big.subarray(0, 2));
            await sleep(60);
            pub.send(big.subarray(2, 40));
            await sleep(60);
            pub.send(big.subarray(40));
            const got = pubOf(await a.next(3));
            assert.equal(got.topic, 'sensors/esp2/light');
            assert.equal(got.payload.length, 300);
            await sleep(100);
            assert.equal(a.got.filter((x) => x.type === 3).length, 0, 'the temp topic never reached the +/light subscriber');
            pub.send(Buffer.from([0xc0, 0]));
            await pub.next(13);
            // A packet over the 64 KB cap ends the connection.
            pub.send(mqttPubPkt('sensors/huge', 'x'.repeat(busMod.MAX_PACKET + 1)));
            await waitFor(() => pub.closed(), 2000, 'the oversize publisher to be dropped');
        } finally { a.end(); all.end(); pub.end(); }
    });
});

test('bus MQTT: a keyed bus wants user "lol" + the farm password (CONNACK 5 otherwise); a same-id reconnect replaces the old session', async () => {
    await withBus({ key: 'pw-farm' }, async (p) => {
        const tries = [[{}, 5], [{ user: 'lol', pass: 'nope' }, 5], [{ user: 'bob', pass: 'pw-farm' }, 5], [{ user: 'lol', pass: 'pw-farm' }, 0]];
        for (const [opts, code] of tries) {
            const c = await mqttRaw(p.mqtt);
            try { assert.equal(await c.connect('k', opts), code, JSON.stringify(opts)); } finally { c.end(); }
        }
        const first = await mqttRaw(p.mqtt);
        const second = await mqttRaw(p.mqtt);
        try {
            assert.equal(await first.connect('board1', { user: 'lol', pass: 'pw-farm' }), 0);
            assert.equal(await second.connect('board1', { user: 'lol', pass: 'pw-farm' }), 0);
            await waitFor(() => first.closed(), 2000, 'the old board1 session to end');
            assert.equal(second.closed(), false);
        } finally { first.end(); second.end(); }
    });
});

test('bus MQTT: a client silent past 1.5× its keep-alive is dropped', async () => {
    await withBus({}, async (p) => {
        const quiet = await mqttRaw(p.mqtt);
        const pinging = await mqttRaw(p.mqtt);
        try {
            assert.equal(await quiet.connect('quiet', { keepAlive: 1 }), 0);
            assert.equal(await pinging.connect('pinging', { keepAlive: 1 }), 0);
            const t0 = Date.now();
            const pinger = setInterval(() => pinging.send(Buffer.from([0xc0, 0])), 500);
            try { await waitFor(() => quiet.closed(), 4000, 'the silent client to be dropped'); } finally { clearInterval(pinger); }
            assert.ok(Date.now() - t0 >= 1400, 'not before 1.5 s');
            assert.equal(pinging.closed(), false, 'a client that pings stays');
        } finally { quiet.end(); pinging.end(); }
    });
});

test('bus WebSocket: ?key on a keyed bus, sub gets an MQTT publish as {topic,data}, a pub reaches MQTT', async () => {
    await withBus({ key: 'pw-farm' }, async (p) => {
        await assert.rejects(wsOpen(`ws://127.0.0.1:${p.ws}/`), /refused/, 'no key → 401');
        await assert.rejects(wsOpen(`ws://127.0.0.1:${p.ws}/?key=wrong`), /refused/, 'a wrong key → 401');
        const w = await wsOpen(`ws://127.0.0.1:${p.ws}/?key=pw-farm`);
        const m = await mqttRaw(p.mqtt);
        try {
            assert.equal(await m.connect('m', { user: 'lol', pass: 'pw-farm' }), 0);
            assert.deepEqual(await m.sub('lol/board1/led'), [0]);
            w.send(JSON.stringify({ sub: 'sensors/#' }));
            assert.deepEqual(await wsNext(w, (x) => 'subscribed' in x), { subscribed: 'sensors/#' });
            m.send(mqttPubPkt('sensors/esp1/light', '{"light":512}'));
            assert.deepEqual(await wsNext(w, (x) => 'topic' in x), { topic: 'sensors/esp1/light', data: { light: 512 } });
            m.send(mqttPubPkt('sensors/esp1/name', 'kitchen'));
            assert.deepEqual(await wsNext(w, (x) => 'topic' in x), { topic: 'sensors/esp1/name', data: 'kitchen' }, 'not JSON → the text');
            w.send(JSON.stringify({ pub: 'lol/board1/led', data: 0.5 }));
            assert.deepEqual(pubOf(await m.next(3)), { topic: 'lol/board1/led', payload: '0.5' });
            w.send(JSON.stringify({ pub: 'lol/board1/led', data: 'on' }));
            assert.deepEqual(pubOf(await m.next(3)), { topic: 'lol/board1/led', payload: 'on' }, 'a string goes as itself');
            w.send(JSON.stringify({ pub: 'bad/#', data: 1 }));
            assert.ok((await wsNext(w, (x) => 'error' in x)).error.includes('cannot publish'));
            w.send('not json');
            assert.ok('error' in await wsNext(w, (x) => 'error' in x));
        } finally { w.close(); m.end(); }
        const open = await fetch(`http://127.0.0.1:${p.ws}/health`);
        assert.equal(open.status, 200, 'the farm probe needs no key');
        assert.equal((await open.json()).bus, true);
    });
});

test('bus WebSocket: fragmented frames are reassembled; over 64 KB closes with 1009; unmasked frames close with 1002', async () => {
    const net = require('net');
    const crypto = require('crypto');
    const frame = (fin, op, payload) => {   // a client frame, masked
        const mask = crypto.randomBytes(4);
        const n = payload.length;
        const head = n < 126 ? Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | n])
            : n < 65536 ? Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | 126, n >> 8, n & 255])
                : Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | op, 0x80 | 127, 0, 0, 0, 0]), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; })()]);
        const body = Buffer.from(payload);
        for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
        return Buffer.concat([head, mask, body]);
    };
    const rawWs = (port) => new Promise((resolve) => {
        const s = net.connect(port, '127.0.0.1', () => s.write(`GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
        s.data = Buffer.alloc(0);
        s.on('data', (d) => { s.data = Buffer.concat([s.data, d]); if (!s.upgraded && s.data.includes('\r\n\r\n')) { s.upgraded = true; s.data = s.data.subarray(s.data.indexOf('\r\n\r\n') + 4); resolve(s); } });
        s.on('error', () => {});
        s.on('close', () => { s.gone = true; });
    });
    await withBus({}, async (p) => {
        const w = await wsOpen(`ws://127.0.0.1:${p.ws}/`);
        const s = await rawWs(p.ws);
        try {
            w.send(JSON.stringify({ sub: 'frag/#' }));
            await wsNext(w, (x) => 'subscribed' in x);
            const msg = JSON.stringify({ pub: 'frag/t', data: { a: 'b' } });
            s.write(frame(false, 1, msg.slice(0, 5)));
            s.write(frame(false, 0, msg.slice(5, 12)));
            s.write(frame(true, 9, 'hi'));                        // a ping between the fragments is allowed
            s.write(frame(true, 0, msg.slice(12)));
            assert.deepEqual(await wsNext(w, (x) => 'topic' in x), { topic: 'frag/t', data: { a: 'b' } });
            await waitFor(() => s.data.includes(Buffer.from([0x8a, 2, 0x68, 0x69])), 2000, 'the pong');
            s.write(frame(false, 1, 'x'.repeat(40000)));
            s.write(frame(true, 0, 'x'.repeat(30000)));
            await waitFor(() => s.gone, 2000, 'the oversize message to close the socket');
            assert.ok(s.data.includes(Buffer.from([0x88, 2, 0x03, 0xf1])), 'close 1009');
            const u = await rawWs(p.ws);
            u.write(Buffer.from([0x81, 2, 0x68, 0x69]));          // unmasked
            await waitFor(() => u.gone, 2000, 'the unmasked client to be closed');
            assert.ok(u.data.includes(Buffer.from([0x88, 2, 0x03, 0xea])), 'close 1002');
        } finally { w.close(); s.destroy(); }
    });
});

test('bus OSC: /lol/listen <filter> <password> [reply port] relays MQTT as OSC; /light 0.5 reaches a WebSocket on osc/light; unlisten', async () => {
    await withBus({ key: 'pw-farm' }, async (p, b) => {
        const listener = await udpSocket();
        const stranger = await udpSocket();
        const tdIn = await udpSocket();   // TouchDesigner/Max: send from one port, listen on another
        const m = await mqttRaw(p.mqtt);
        const w = await wsOpen(`ws://127.0.0.1:${p.ws}/?key=pw-farm`);
        try {
            stranger.send(busMod.oscEncode('/lol/listen', ['sensors/#']), p.osc, '127.0.0.1');
            stranger.send(busMod.oscEncode('/lol/listen', ['sensors/#', 'wrong']), p.osc, '127.0.0.1');
            listener.send(busMod.oscEncode('/lol/listen', ['sensors/#', 'pw-farm']), p.osc, '127.0.0.1');
            await waitFor(() => listener.got.some((x) => x.address === '/lol/listening'), 2000, 'the /lol/listening answer');
            assert.deepEqual(listener.got.shift(), { address: '/lol/listening', args: ['sensors/#'] });
            assert.equal(b.counts().osc, 1, 'no password → ignored');
            stranger.send(busMod.oscEncode('/lol/listen', ['sensors/+/light', 'pw-farm', tdIn.address().port]), p.osc, '127.0.0.1');
            await waitFor(() => tdIn.got.some((x) => x.address === '/lol/listening'), 2000, 'the answer at the reply port');
            tdIn.got.length = 0;
            assert.equal(await m.connect('m', { user: 'lol', pass: 'pw-farm' }), 0);
            m.send(mqttPubPkt('sensors/esp1/light', '42'));
            m.send(mqttPubPkt('sensors/esp1/rgb', '[1,0.5,"x",true]'));
            await waitFor(() => listener.got.length >= 2, 2000, 'two OSC packets');
            assert.deepEqual(listener.got, [
                { address: '/sensors/esp1/light', args: [42] },
                { address: '/sensors/esp1/rgb', args: [1, 0.5, 'x', true] },
            ]);
            assert.equal(stranger.got.length, 0, 'the unkeyed sender gets nothing at its own port');
            assert.deepEqual(tdIn.got, [{ address: '/sensors/esp1/light', args: [42] }], 'the reply port gets its filter only');
            // A device's OSC → osc/<address> for the WebSocket hub (and MQTT).
            w.send(JSON.stringify({ sub: 'osc/#' }));
            await wsNext(w, (x) => 'subscribed' in x);
            stranger.send(busMod.oscEncode('/light', 0.5), p.osc, '127.0.0.1');
            assert.deepEqual(await wsNext(w, (x) => 'topic' in x), { topic: 'osc/light', data: 0.5 });
            stranger.send(busMod.oscEncode('/xy', [0.25, 7]), p.osc, '127.0.0.1');
            assert.deepEqual(await wsNext(w, (x) => 'topic' in x), { topic: 'osc/xy', data: [0.25, 7] }, 'several arguments → an array');
            listener.send(busMod.oscEncode('/lol/unlisten', null), p.osc, '127.0.0.1');
            await waitFor(() => b.counts().osc === 1, 2000, 'the first unlisten');
            stranger.send(busMod.oscEncode('/lol/unlisten', [tdIn.address().port]), p.osc, '127.0.0.1');
            await waitFor(() => b.counts().osc === 0, 2000, 'the unlisten by reply port');
        } finally { listener.close(); stranger.close(); tdIn.close(); m.end(); w.close(); }
    });
    // Critic N4: a password a tool types as a NUMBER is compared as text, and never becomes the reply port.
    await withBus({ key: '4242' }, async (p, b) => {
        const numeric = await udpSocket();
        try {
            numeric.send(busMod.oscEncode('/lol/listen', ['sensors/#', 4242]), p.osc, '127.0.0.1');
            await waitFor(() => numeric.got.some((x) => x.address === '/lol/listening'), 2000, 'the answer at the SENDING port, not at port 4242');
            assert.equal(b.counts().osc, 1);
        } finally { numeric.close(); }
    });
});

test('bus WebSocket: a page from the public web is refused; a board, the Computer (null/file) and LAN pages are not (critic N3)', () => {
    for (const ok of [undefined, '', 'null', 'file://', 'http://localhost:5173', 'http://127.0.0.1:8080', 'http://192.168.1.20', 'http://10.10.16.4:3000',
        'https://studio-pc', 'http://farm.local', 'http://[::1]:9000', 'http://[fd00::5]']) assert.equal(busMod.originOk(ok), true, String(ok));
    for (const no of ['https://evil.example', 'http://8.8.8.8', 'http://172.32.0.1', 'chrome-extension://abc', 'not a url']) assert.equal(busMod.originOk(no), false, no);
});

test('bus WebSocket: the hub itself answers 403 to a public Origin, and still opens for no Origin', async () => {
    const net = require('net');
    await withBus({}, async (p) => {
        const ask = (origin) => new Promise((resolve) => {
            const s = net.connect(p.ws, '127.0.0.1', () => s.write(`GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n${origin ? `Origin: ${origin}\r\n` : ''}\r\n`));
            let got = '';
            s.on('data', (d) => { got += d; if (got.includes('\r\n\r\n')) { s.destroy(); resolve(got.split('\r\n')[0]); } });
            s.on('error', () => resolve(got.split('\r\n')[0]));
        });
        assert.equal(await ask('https://evil.example'), 'HTTP/1.1 403 Forbidden');
        assert.equal(await ask(null), 'HTTP/1.1 101 Switching Protocols');
    });
});

test('bus: over 200 messages/s per client are dropped (said once); no payload or password ever reaches the log', async () => {
    const SECRET = 'PAYLOAD-7f3a91';
    await withBus({ key: 'pw-hidden-42' }, async (p, b, lines) => {
        const sub = await mqttRaw(p.mqtt);
        const pub = await mqttRaw(p.mqtt);
        const osc = await udpSocket();
        try {
            assert.equal(await sub.connect('s', { user: 'lol', pass: 'pw-hidden-42' }), 0);
            assert.equal(await pub.connect('p', { user: 'lol', pass: 'pw-hidden-42' }), 0);
            await sub.sub('flood/#');
            pub.send(Buffer.concat(Array.from({ length: 250 }, (_, i) => mqttPubPkt('flood/x', `${SECRET}-${i}`))));
            await waitFor(() => sub.got.filter((x) => x.type === 3).length >= 200, 3000, '200 deliveries');
            await sleep(200);
            assert.equal(sub.got.filter((x) => x.type === 3).length, 200, 'exactly the cap in one second');
            // Refusals on every door, and traffic through every door, all carrying the marker.
            const bad = await mqttRaw(p.mqtt);
            assert.equal(await bad.connect('x', { user: 'lol', pass: `${SECRET}-guess` }), 5);
            bad.end();
            await assert.rejects(wsOpen(`ws://127.0.0.1:${p.ws}/?key=${SECRET}`));
            osc.send(busMod.oscEncode('/lol/listen', [`${SECRET}/#`, `${SECRET}-pw`]), p.osc, '127.0.0.1');
            osc.send(busMod.oscEncode(`/${SECRET}`, SECRET), p.osc, '127.0.0.1');
            const w = await wsOpen(`ws://127.0.0.1:${p.ws}/?key=pw-hidden-42`);
            w.send(JSON.stringify({ pub: `t/${SECRET}`, data: SECRET }));
            w.send(`${SECRET} not json`);
            await wsNext(w, (x) => 'error' in x);
            w.close();
            await waitFor(() => lines.some((l) => l.startsWith('WebSocket: refused')) && lines.some((l) => l.startsWith('OSC: refused')), 2000, 'the refusals');
            b.setKey('pw-new-99');
            assert.equal(b.stats.dropped >= 50, true);
        } finally { sub.end(); pub.end(); osc.close(); }
        const text = lines.join('\n');
        assert.ok(/over 200 messages\/s/.test(text), 'the drop is said');
        assert.equal(text.match(/over 200 messages\/s/g).length, 1, 'said once');
        assert.ok(lines.some((l) => l.startsWith('MQTT: refused')), 'refusals are said');
        assert.ok(!text.includes(SECRET), 'no payload, topic or guessed password in the log');
        assert.ok(!text.includes('pw-hidden-42') && !text.includes('pw-new-99'), 'no farm password in the log');
    });
});

test('bus: the registry runs it as its own process; the snapshot advertises it only when up (never the password); a new password reaches it; lol down stops it', async () => {
    const net = require('net');
    const dgram = require('dgram');
    const freeTcp = async () => { const s = net.createServer(); await new Promise((r) => s.listen(0, '127.0.0.1', r)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };
    const freeUdp = async () => { const s = dgram.createSocket('udp4'); await new Promise((r) => s.bind(0, '127.0.0.1', r)); const p = s.address().port; await new Promise((r) => s.close(r)); return p; };
    const c = defaultConfig();
    c.proxy.host = '127.0.0.1';
    c.proxy.masterKey = 'pw-one';
    c.bus = { enabled: true, mqttPort: await freeTcp(), wsPort: await freeTcp(), oscPort: await freeUdp() };
    const svc = makeServices().find((s) => s.id === 'bus');
    const out = [];
    const log = { step() {}, ok() {}, warn() {}, err() {}, childPrefix: () => (d) => out.push(String(d)) };
    const res = await svc.start(c, { log });
    try {
        assert.equal(res.ok, true, res.message);
        assert.ok(svc.pid && svc.pid !== process.pid, 'its own process');
        const snap = buildSnapshot(c, { proxyUp: true, hostsUp: 1, busUp: svc.up });
        assert.deepEqual(snap.bus, {
            mqtt: `mqtt://127.0.0.1:${c.bus.mqttPort}`, ws: `ws://127.0.0.1:${c.bus.wsPort}`, osc: `udp://127.0.0.1:${c.bus.oscPort}`, auth: true,
        });
        assert.ok(!JSON.stringify(snap).includes('pw-one'), 'never the password');
        assert.equal(buildSnapshot(c, { proxyUp: true, hostsUp: 1, busUp: false }).bus, null, 'down → not advertised');
        assert.equal(buildSnapshot({ ...c, bus: { ...c.bus, enabled: false } }, { proxyUp: true, hostsUp: 1, busUp: true }).bus, null, 'off → not advertised');
        assert.equal(buildSnapshot({ ...c, proxy: { ...c.proxy, masterKey: null } }, { proxyUp: true, hostsUp: 1, busUp: true }).bus.auth, false);
        // The health tick's password hand-over: the old session ends, only the new password connects.
        const m = await mqttRaw(c.bus.mqttPort);
        assert.equal(await m.connect('m', { user: 'lol', pass: 'pw-one' }), 0);
        busMod.sendKey(svc.child, 'pw-one');
        await sleep(150);
        assert.equal(m.closed(), false, 'an unchanged password changes nothing');
        busMod.sendKey(svc.child, 'pw-two');
        await waitFor(() => m.closed(), 3000, 'the old session to end');
        for (const [pass, code] of [['pw-one', 5], ['pw-two', 0]]) {
            const t = await mqttRaw(c.bus.mqttPort);
            try { assert.equal(await t.connect('t', { user: 'lol', pass }), code, pass); } finally { t.end(); }
        }
        assert.ok(out.join('').includes('listening — MQTT'), 'its log reaches the farm log');
        assert.ok(!out.join('').includes('pw-'), 'no password in the child log');
    } finally { await svc.stop(); }
    assert.equal(await busMod.busAlive(c.bus.wsPort), false, 'stopped');
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    const downSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'down.js'), 'utf8');
    assert.ok(/busPid: svcById\.bus\.pid/.test(upSrc) && /rt\.busPid/.test(downSrc), '`lol down` from another shell finds and stops it');
    assert.ok(/sendBusKey\(svcById\.bus\.child, config\.proxy\.masterKey\)/.test(upSrc), 'the health tick hands it the password');
});

// ---- an external vLLM read through its /metrics (multi-user plan Phase 2a) -----
// What a vLLM serves, in prometheus_client's text format. Names and labels from vLLM
// 0.14.0's own source (v1/metrics/loggers.py, v1/spec_decode/metrics.py, the
// CacheConfig fields cache_config_info carries) — no live server was up to capture one.
// `engines` > 1 = data parallel: one series per engine.
function vllmMetrics(o = {}) {
    const v = { running: 3, waiting: 2, kv: 0.42, queries: 10000, hits: 6000, gen: 5000, itlSum: 100, itlCount: 4000, draft: 3000, accepted: 2100, blocks: 8192, engines: 1, old: false, info: '', ...o };
    const L = (e) => `engine="${e}",model_name="assistant"`;
    const out = [
        '# HELP python_gc_objects_collected_total Objects collected during gc',
        '# TYPE python_gc_objects_collected_total counter',
        'python_gc_objects_collected_total{generation="0"} 15432.0',
        'process_resident_memory_bytes 4.21740544e+09',
    ];
    for (let e = 0; e < v.engines; e++) {
        const kv = Array.isArray(v.kv) ? v.kv[e] : v.kv;
        out.push(
            '# HELP vllm:num_requests_running Number of requests in model execution batches.',
            '# TYPE vllm:num_requests_running gauge',
            `vllm:num_requests_running{${L(e)}} ${v.running}.0`,
            `vllm:num_requests_waiting{${L(e)}} ${v.waiting}.0`,
            `vllm:${v.old ? 'gpu_cache_usage_perc' : 'kv_cache_usage_perc'}{${L(e)}} ${kv}`,
            `vllm:${v.old ? 'gpu_prefix_cache_queries' : 'prefix_cache_queries'}_total{${L(e)}} ${v.queries}.0`,
            `vllm:${v.old ? 'gpu_prefix_cache_queries' : 'prefix_cache_queries'}_created{${L(e)}} 1.7596e+09`,
            `vllm:${v.old ? 'gpu_prefix_cache_hits' : 'prefix_cache_hits'}_total{${L(e)}} ${v.hits}.0`,
            `vllm:prompt_tokens_total{${L(e)}} 12000.0`,
            `vllm:generation_tokens_total{${L(e)}} ${v.gen}.0`,
            `vllm:generation_tokens_created{${L(e)}} 1.7596e+09`,
            '# TYPE vllm:inter_token_latency_seconds histogram',
            `vllm:${v.old ? 'time_per_output_token_seconds' : 'inter_token_latency_seconds'}_bucket{${L(e)},le="0.025"} 3900.0`,
            `vllm:${v.old ? 'time_per_output_token_seconds' : 'inter_token_latency_seconds'}_bucket{${L(e)},le="+Inf"} ${v.itlCount}.0`,
            `vllm:${v.old ? 'time_per_output_token_seconds' : 'inter_token_latency_seconds'}_count{${L(e)}} ${v.itlCount}.0`,
            `vllm:${v.old ? 'time_per_output_token_seconds' : 'inter_token_latency_seconds'}_sum{${L(e)}} ${v.itlSum}`,
            `vllm:time_to_first_token_seconds_count{${L(e)}} 40.0`,
        );
        if (v.draft != null) {
            out.push(
                `vllm:spec_decode_num_drafts_total{${L(e)}} 1000.0`,
                `vllm:spec_decode_num_draft_tokens_total{${L(e)}} ${v.draft}.0`,
                `vllm:spec_decode_num_accepted_tokens_total{${L(e)}} ${v.accepted}.0`,
                `vllm:spec_decode_num_accepted_tokens_per_pos_total{${L(e)},position="0"} 900.0`,
            );
        }
        out.push(
            '# HELP vllm:cache_config_info Information of the LLMEngine CacheConfig',
            '# TYPE vllm:cache_config_info gauge',
            `vllm:cache_config_info{block_size="16",cache_dtype="fp8",calculate_kv_scales="False",cpu_offload_gb="0",enable_prefix_caching="True",engine="${e}",gpu_memory_utilization="0.9",is_attention_free="False",kv_cache_memory_bytes="None",mamba_block_size="None",num_cpu_blocks="None",num_gpu_blocks="${v.blocks}",num_gpu_blocks_override="None",prefix_caching_hash_algo="sha256",sliding_window="None",swap_space="4"${v.info}} 1.0`,
        );
    }
    return out.join('\n') + '\n';
}

test('vLLM /metrics: the names vLLM itself uses → load, KV, cache hits, per-person + total tok/s, draft acceptance, pool', () => {
    const s0 = perfMod.vllmSample(perfMod.parsePrometheus(vllmMetrics()), 0);
    assert.equal(s0.busy, 3);
    assert.equal(s0.queued, 2);
    assert.equal(s0.kvUsed, 0.42);
    assert.equal(s0.poolTokens, 8192 * 16, 'num_gpu_blocks × block_size');
    // 10 s later: 1000 more tokens, of which streams spent 20 s decoding (several at once).
    const s1 = perfMod.vllmSample(perfMod.parsePrometheus(vllmMetrics({ gen: 6000, itlSum: 120, queries: 12000, hits: 7500, draft: 4000, accepted: 2800 })), 10000);
    const r = perfMod.sampleRates(s0, s1);
    assert.equal(r.genTokSec, 50, 'per person while generating: tokens / decode seconds, not wall clock');
    assert.equal(r.throughputTokSec, 100, 'everyone together: tokens / wall clock');
    assert.equal(r.cacheHitRatio, 0.75, 'prefix-cache hits / queries over the window');
    assert.equal(r.draftAcceptRatio, 0.7, 'accepted / drafted tokens');
    assert.equal(r.promptTokSec, null, 'vLLM has no prefill-seconds counter — no reading speed rather than a wrong one');
    assert.equal(perfMod.sampleRates(s1, perfMod.vllmSample(perfMod.parsePrometheus(vllmMetrics({ gen: 10 })), 20000)).reset, true, 'a restarted vLLM resets its counters');
    assert.equal(perfMod.sampleRates(s0, perfMod.vllmSample(perfMod.parsePrometheus(vllmMetrics({ draft: null })), 10000)).draftAcceptRatio, null, 'no drafter → no acceptance');
    // vLLM < 0.9 names (gpu_cache_usage_perc, gpu_prefix_cache_*, time_per_output_token_seconds).
    const o0 = perfMod.vllmSample(perfMod.parsePrometheus(vllmMetrics({ old: true })), 0);
    const o1 = perfMod.vllmSample(perfMod.parsePrometheus(vllmMetrics({ old: true, gen: 6000, itlSum: 120, queries: 12000, hits: 7500 })), 10000);
    assert.equal(o0.kvUsed, 0.42);
    assert.deepEqual([perfMod.sampleRates(o0, o1).genTokSec, perfMod.sampleRates(o0, o1).cacheHitRatio], [50, 0.75]);
    // Data parallel: counts add up, the fullest engine's KV is the one that preempts, pools add up.
    const dp = perfMod.vllmSample(perfMod.parsePrometheus(vllmMetrics({ engines: 2, kv: [0.2, 0.9] })), 0);
    assert.deepEqual([dp.busy, dp.queued, dp.kvUsed, dp.poolTokens], [6, 4, 0.9, 2 * 8192 * 16]);
    // vLLM >= 0.25 says its group-aware pool itself (blocks × block_size over-counts a hybrid model).
    assert.equal(perfMod.vllmSample(perfMod.parsePrometheus(vllmMetrics({ info: ',kv_cache_size_tokens="60000",kv_cache_max_concurrency="1.83"' })), 0).poolTokens, 60000);
    assert.equal(perfMod.vllmSample(perfMod.parsePrometheus(vllmMetrics({ blocks: 'None' })), 0).poolTokens, null, 'an unsized pool is unknown, not 0');
    // Not a vLLM → null, so the caller keeps today's behaviour.
    assert.equal(perfMod.vllmSample(perfMod.parsePrometheus('llamacpp:requests_processing 1\nllamacpp:tokens_predicted_total 5\n'), 0), null);
    assert.equal(perfMod.vllmSample(perfMod.parsePrometheus('<html>{{ not metrics\u0000'), 0), null);
    assert.equal(perfMod.vllmSample(null, 0), null);
    assert.equal(perfMod.metricsUrlFor('http://10.0.0.5:8000/v1'), 'http://10.0.0.5:8000/metrics');
    assert.equal(perfMod.metricsUrlFor('http://10.0.0.5:8000/v1/'), 'http://10.0.0.5:8000/metrics');
    assert.equal(perfMod.metricsUrlFor('https://gpu.lan/vllm/v1'), 'https://gpu.lan/vllm/metrics');
    // The declared seats × window against the pool.
    const w = perfMod.poolShortfall(8, 32768, 131072);
    assert.equal(w, 'The server holds context memory for 4 people at 32k, fewer than the 8 this farm lets in at once: past 4, people wait.');
    assert.equal(perfMod.poolShortfall(4, 32768, 131072), null, 'an exact fit is a fit');
    assert.ok(/not even one person's whole conversation fits/.test(perfMod.poolShortfall(1, 32768, 16000)));
    assert.equal(perfMod.poolShortfall(8, 32768, null), null, 'unknown pool → no warning');
    // The vLLM the farm runs: the panel's own controls are the fix (§3.9); no config key in either wording (D10).
    const v = perfMod.poolShortfall(48, 65536, 655360, 'vllm');
    assert.equal(v, 'The memory for conversations holds 10 people at 64k, fewer than the 48 this farm lets in at once: past 10, people wait. Lower People at once or Context per person, or give vLLM more GPU memory for conversations.');
    for (const s of [w, v, perfMod.poolShortfall(3, 40000, 50000)]) assert.ok(!/external\.|\.parallel|contextLength|lol\.config/.test(s), s);
});

test('external vLLM, end to end: a fake /metrics feeds capacity.busy/queued, the card and its pool warning; seats unchanged (plan Phase 2a)', async () => {
    const http = require('http');
    const { makePerfSampler } = require('../src/commands/up');
    let body = vllmMetrics();
    let status = 200;
    const auths = [];
    const fake = http.createServer((req, res) => {
        auths.push(req.headers.authorization || null);
        if (req.url !== '/metrics') { res.writeHead(404); return res.end(); }
        res.writeHead(status, { 'content-type': 'text/plain; version=0.0.4' });
        res.end(body);
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    const realNow = Date.now;
    let t = 1000;
    Date.now = () => t;
    try {
        const c = defaultConfig();
        Object.assign(c.external, { enabled: true, baseUrl: `http://127.0.0.1:${fake.address().port}/v1`, parallel: 8, contextLength: 32768, apiKey: 'k-ext', label: 'Qwen3.6 (vLLM)' });
        c.llamacpp.enabled = false;
        const health = { engineUp: true, perf: null };
        const sampler = makePerfSampler(c, health, () => false);
        health.perf = await sampler.sample();
        assert.equal(health.perf.engine, 'vllm');
        assert.equal(auths[0], 'Bearer k-ext', 'the external bearer rides along');
        t = 11000;
        body = vllmMetrics({ gen: 6000, itlSum: 120, queries: 12000, hits: 7500, draft: 4000, accepted: 2800 });
        health.perf = await sampler.sample();
        const p = health.perf;
        assert.deepEqual(
            [p.busySlots, p.totalSlots, p.queued, p.kvUsed, p.lastGenTokSec, p.lastThroughputTokSec, p.lastCacheHitRatio, p.lastDraftAcceptRatio, p.kvPoolTokens, p.lastActiveTs],
            [3, 8, 2, 0.42, 50, 100, 0.75, 0.7, 131072, 11000]);
        // The snapshot: live load for clients, the seats still the declaration (owner 2026-09-07a).
        const snap = buildSnapshot(c, health);
        assert.deepEqual([snap.capacity.busy, snap.capacity.queued, snap.capacity.slots], [3, 2, 8]);
        assert.equal(snap.backend.slotsVerified, false, 'metrics can show a declaration does not fit, never that it does');
        assert.equal(snap.backend.contextPerSlot, 32768, 'the window is not re-derived from the pool');
        // The card: a vLLM's numbers, its pool warning, and none of llama.cpp's VRAM warnings
        // (a vLLM fills VRAM on purpose).
        const render = loadPanel();
        const ext = { engine: 'external', alias: 'assistant', model: 'Qwen3.6 (vLLM)', baseUrl: c.external.baseUrl, contextLength: 32768, contextPerSlot: 32768, contextAuto: false, slots: 8, slotsVerified: false };
        const cap = { slots: 8, clients: 0, seats: [], seatIdleSec: 900, slotsVerified: false, unmanagedHosts: [], ollamaEnvAdvice: null };
        const gpu = { vramUsedGb: 94, vramTotalGb: 96, gpuUtil: 2 };
        const html = render(adminState({
            backend: ext, capacity: cap, perf: p, perfHistory: sampler.history, models: [],
            health: { hostsUp: 1, hostsTotal: 1, proxyUp: true, gpu, host: null },
            poolWarning: perfMod.poolShortfall(c.external.parallel, c.external.contextLength, p.kvPoolTokens),
        }));
        for (const needle of ['<h2>Performance</h2>', '50 <small>tok/s while generating', 'Generating now <b>3</b> requests', 'Waiting <b>2</b>',
            'Context memory used <b>42%</b>', 'Context memory <b>131,072 tokens</b>', 'All together <b>100 tok/s</b>',
            'Context cache hits <b>75%</b>', 'Draft tokens accepted <b>70%</b>', 'holds context memory for 4 people at 32k']) {
            assert.ok(html.includes(needle) || html.includes(needle.replace('&#39;', "'")), `card lost: ${needle}`);
        }
        assert.ok(!html.includes('nearly full while idle'), 'no llama.cpp VRAM warning on a vLLM');
        assert.ok(!html.includes('Capacity is unverified'), 'the Ollama env advice never shows for an external server');
        assert.ok(/poolWarning: \['external', 'vllm'\]\.includes\(engineOf\(config\)\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8')), 'the admin state carries the warning, for an external server and the farm\'s vLLM');

        // Graceful degradation — exactly today's external behaviour: perf null, no card,
        // capacity.busy/queued null.
        const fresh = async (h = { engineUp: true, perf: null }) => makePerfSampler(c, h, () => false).sample();
        body = 'llamacpp:requests_processing 1\n';
        assert.equal(await fresh(), null, 'answers, but not a vLLM');
        body = '<html>{{ not metrics\u0000';
        assert.equal(await fresh(), null, 'malformed');
        status = 404;
        assert.equal(await fresh(), null, 'no /metrics');
        assert.equal(await fresh({ engineUp: false, perf: null }), null, 'a server that stopped answering is not read');
        const none = buildSnapshot(c, { engineUp: true, perf: null });
        assert.deepEqual([none.capacity.busy, none.capacity.queued, none.perf], [null, null, null]);
        assert.ok(!render(adminState({ backend: ext, capacity: cap, perf: null })).includes('<h2>Performance</h2>'), 'no card until it proves to be a vLLM');
        // One failed scrape keeps the last numbers (as on llama.cpp); a non-vLLM answer drops them.
        status = 200; body = vllmMetrics();
        const h2 = { engineUp: true, perf: null };
        const s2 = makePerfSampler(c, h2, () => false);
        h2.perf = await s2.sample();
        status = 500;
        assert.equal(await s2.sample(), h2.perf, 'a failed scrape must not blank the panel');
        status = 200; body = 'sglang:num_running_reqs 1\n';
        assert.equal(await s2.sample(), null);
        // llama.cpp through the same sampler keeps exactly its old perf shape (so its card is unchanged).
        const lc = defaultConfig();
        Object.assign(lc.llamacpp, { enabled: true, port: fake.address().port, parallel: 2 });
        body = 'llamacpp:tokens_predicted_total 10\nllamacpp:tokens_predicted_seconds_total 1\nllamacpp:requests_processing 1\nllamacpp:requests_deferred 0\n';
        const lp = await makePerfSampler(lc, { perf: null }, () => true).sample();
        assert.deepEqual(Object.keys(lp), ['engine', 'genTokSec', 'lastGenTokSec', 'lastPromptTokSec', 'lastCacheHitRatio', 'lastActiveTs', 'busySlots', 'totalSlots', 'queued', 'kvUsed']);
        assert.deepEqual([lp.engine, lp.busySlots, lp.totalSlots], ['llama.cpp', 1, 2]);
    } finally {
        Date.now = realNow;
        fake.close();
    }
});

test('capacity.mine: unicast /lol/self says whether the CALLER holds a seat; the beacon never carries it', async () => {
    const { DiscoveryBeacon } = require('../src/beacon');
    const c = defaultConfig();
    const seats = seatsMod.createSeats({ capacity: () => 2, idleReleaseSec: () => 900 });
    const health = { proxyUp: true, getSeats: () => seats.view() };
    const getSnapshot = (callerIp) => buildSnapshot(c, health, callerIp);   // up.js's shape
    const server = startSelfServer({ httpPort: 0, getSnapshot, host: '127.0.0.1' });
    await new Promise((r) => { if (server.listening) r(); else server.once('listening', r); });
    const self = async () => (await (await fetch(`http://127.0.0.1:${server.address().port}/lol/self`)).json()).capacity;
    try {
        assert.equal((await self()).mine, false, 'no seat yet');
        seats.admit('10.0.0.9');
        assert.equal((await self()).mine, false, "someone else's seat is not mine");
        seats.admit('::ffff:127.0.0.1');   // the gate sees a v4-mapped address: normalized like seats.js
        const cap = await self();
        assert.equal(cap.mine, true);
        assert.equal(cap.seatsUsed, 2);
        // The beacon builds the same snapshot with no caller: never `mine`.
        const sent = [];
        const b = new DiscoveryBeacon({ group: '239.255.43.10', port: 41998, intervalSec: 5, getSnapshot });
        b.socket = { send: (buf) => sent.push(JSON.parse(buf.toString())) };
        b._send();
        assert.ok(sent.length >= 1);
        assert.ok(sent.every((s) => !('mine' in s.capacity) && s.capacity.seatsUsed === 2), 'per-caller field kept out of the broadcast');
        assert.equal(buildSnapshot(c, {}, '127.0.0.1').capacity.mine, false, 'gate off → nobody holds a seat');
    } finally {
        server.close();
    }
});

// ---- the snapshot contract (multi-user plan 4.4) ---------------------------
// contract/snapshot.schema.json describes the beacon and GET /lol/self. No JSON Schema validator is
// a farm dependency, so this is the smallest one for the subset the schema uses: type, enum,
// required, properties, additionalProperties, items and a local $ref. Returns the problems found.
function schemaErrors(schema, value, root = schema, at = '$') {
    if (schema.$ref) return schemaErrors(root.$defs[schema.$ref.split('/').pop()], value, root, at);
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const types = [].concat(schema.type || []);
    if (types.length && !types.includes(kind) && !(kind === 'integer' && types.includes('number'))) return [`${at}: ${kind}, expected ${types.join(' or ')}`];
    if (schema.enum && !schema.enum.includes(value)) return [`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.join(', ')}`];
    const errs = [];
    if (kind === 'array' && schema.items) value.forEach((v, i) => errs.push(...schemaErrors(schema.items, v, root, `${at}[${i}]`)));
    if (kind === 'object') {
        for (const k of schema.required || []) if (!(k in value)) errs.push(`${at}.${k}: missing`);
        for (const [k, v] of Object.entries(value)) {
            const sub = Object.hasOwn(schema.properties || {}, k) ? schema.properties[k] : schema.additionalProperties;
            if (sub === false) errs.push(`${at}.${k}: not in the schema`);
            else if (sub && sub !== true) errs.push(...schemaErrors(sub, v, root, `${at}.${k}`));
        }
    }
    return errs;
}
const SNAPSHOT_SCHEMA = require('../contract/snapshot.schema.json');
const contractExamples = require('../contract/examples');

test('contract: every engine\'s snapshot, and what farm-v0.0.41 sent, match contract/snapshot.schema.json', () => {
    const all = contractExamples();
    // "not in the schema": a new field goes into contract/snapshot.schema.json, optional, with who reads it.
    for (const { label, snap } of all) {
        const errs = schemaErrors(SNAPSHOT_SCHEMA, snap);
        assert.deepEqual(errs, [], `${label}: ${errs.join('; ')}`);
    }
    // The examples cover what they claim: each engine, a password, a coordinator, GET /lol/self and the beacon.
    assert.deepEqual([...new Set(all.map((e) => e.snap.backend.engine))].sort(), ['external', 'llama.cpp', 'ollama', 'vllm']);
    assert.ok(all.some((e) => e.snap.requiresKey) && all.some((e) => e.snap.coordinator));
    assert.ok(all.some((e) => e.snap.capacity.mine === true) && all.some((e) => !('mine' in e.snap.capacity)));
    assert.ok(all.some((e) => e.snap.version === '0.0.41'));
    // A field made required that an old farm does not send would cut every client off from that farm.
    // farm-v0.0.41 passing above reaches back to that release only; these are the top-level keys the
    // first one sent (git show farm-v0.0.1:farm/src/snapshot.js), frozen.
    const FARM_V0_0_1_KEYS = ['v', 'id', 'name', 'proxyPort', 'httpPort', 'ips', 'endpoint', 'openaiBaseUrl', 'requiresKey', 'models',
        'healthy', 'version', 'coordinator', 'searxngUrl', 'ttsUrl', 'ttsVoice', 'ttsModel', 'extract', 'plugins',
        'recommendedClientPlugins', 'deployments', 'health', 'host', 'usage', 'ts'];
    assert.deepEqual(SNAPSHOT_SCHEMA.required.filter((k) => !FARM_V0_0_1_KEYS.includes(k)), [], 'required, but farm-v0.0.1 does not send it');
});

test('contract: a field the schema does not declare fails, so a new one is added on purpose', () => {
    const snap = require('../contract/snapshot.farm-v0.0.41.json');   // frozen, so only the checker is under test
    assert.deepEqual(schemaErrors(SNAPSHOT_SCHEMA, { ...snap, contractVersion: 2 }), ['$.contractVersion: not in the schema']);
    assert.deepEqual(schemaErrors(SNAPSHOT_SCHEMA, { ...snap, capacity: { ...snap.capacity, metrics: {} } }), ['$.capacity.metrics: not in the schema']);
    const { name, ...nameless } = snap;
    assert.deepEqual(schemaErrors(SNAPSHOT_SCHEMA, nameless), ['$.name: missing']);
    assert.deepEqual(schemaErrors(SNAPSHOT_SCHEMA, { ...snap, capacity: { ...snap.capacity, slots: '2' } }), ['$.capacity.slots: string, expected integer']);
    assert.deepEqual(schemaErrors(SNAPSHOT_SCHEMA, { ...snap, backend: { ...snap.backend, engine: 'sglang' } }), ['$.backend.engine: "sglang" is not one of ollama, llama.cpp, vllm, external']);
    assert.deepEqual(schemaErrors(SNAPSHOT_SCHEMA, { ...snap, extract: { key: null } }), ['$.extract.url: missing'], 'through the $ref');
    assert.deepEqual(schemaErrors(SNAPSHOT_SCHEMA, { ...snap, models: [{ id: 'a' }, { default: true }] }), ['$.models[1].id: missing']);
    // Every property says who reads it (the schema is the one place a reader looks that up).
    const undescribed = [];
    const walk = (s, at) => {
        for (const [k, p] of Object.entries(s.properties || {})) { if (!p.description) undescribed.push(`${at}.${k}`); walk(p, `${at}.${k}`); }
        if (s.items) walk(s.items, `${at}[]`);
        if (s.additionalProperties && typeof s.additionalProperties === 'object') walk(s.additionalProperties, `${at}.*`);
    };
    walk(SNAPSHOT_SCHEMA, '$');
    for (const [k, d] of Object.entries(SNAPSHOT_SCHEMA.$defs)) walk(d, `$defs.${k}`);
    assert.deepEqual(undescribed, []);
});

// ---- the panel's slots-vs-context line (plan §13b) ----------------------------
test('panel: the context it says each person gets is what the farm advertises, per engine', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
    const start = html.indexOf('function perPerson');
    const end = html.indexOf('const CLIENT');
    assert.ok(start > 0 && end > start, 'panel source moved — update the extraction anchors');
    const ctx = {};
    new Function('ctx', html.slice(start, end) + '; ctx.out = perPerson;')(ctx);
    const perPerson = ctx.out;
    const engines = [
        ['ollama', (c, n, w) => { c.llamacpp.enabled = false; c.ollama.numParallel = n; c.ollama.contextLength = w; }],
        ['llama.cpp', (c, n, w) => { c.llamacpp.enabled = true; c.llamacpp.parallel = n; c.llamacpp.contextLength = w; }],
        ['llama.cpp', (c, n, w) => { c.llamacpp.enabled = true; c.llamacpp.kvUnified = false; c.llamacpp.parallel = n; c.llamacpp.contextLength = w; }],
        ['external', (c, n, w) => { c.external.enabled = true; c.external.parallel = n; c.external.contextLength = w; }],
    ];
    for (const [engine, set] of engines) {
        for (const n of [1, 2, 3, 4, 6, 8, 48]) {
            for (const w of [8192, 16384, 65536, 100000, 262144]) {
                const c = defaultConfig();
                set(c, n, w);
                const be = backendInfo(c, { hostsUp: 2 });
                assert.equal(be.engine, engine);
                assert.equal(perPerson(engine, w, n), be.contextPerSlot, `${engine} ${w} tokens, ${n} at once`);
            }
        }
    }
});

test('panel: the slots-vs-context line says what an edit does before Apply (plan §13b)', () => {
    const render = loadPanel();
    const lcState = (over = {}) => adminState({
        backend: { engine: 'llama.cpp', alias: 'assistant', model: 'q.gguf', contextLength: 65536, contextPerSlot: 32768, contextAuto: false, kvUnified: true, slots: 2, slotsVerified: true },
        llamacpp: { enabled: true, running: true, alias: 'assistant', library: [], contextLength: 65536, contextResolved: 65536, parallel: 2 },
        capacity: { slots: 2, clients: 0, seats: [], seatIdleSec: 900, slotsVerified: true, unmanagedHosts: [], ollamaEnvAdvice: null },
        ...over,
    });
    const edit = (slots, ctx) => {
        render.el('#slots-sel').value = String(slots);
        render.el('#ctx-sel').value = String(ctx);
        render.el('#ctx-sel').onchange();
        return render.el('#trade').innerHTML;
    };
    // As configured: llama.cpp, 64k shared by 2 → at least 32k each, whole documents, nothing to warn of.
    const now = render(lcState());
    assert.ok(now.includes('id="trade"'), 'the line sits in the Backend card');
    assert.ok(now.includes('Each person gets at least <b>32k</b> of context: 64k shared by 2'), now);
    assert.ok(now.includes('reads attached documents whole') && !now.includes('restarts once'));
    assert.ok(!now.includes('guaranteed with'), 'the Context window row no longer restates the sum the line makes');
    // 4 at once → 16k each: excerpts, every Open WebUI restarts, the agent's Keep going shrinks.
    const four = edit(4, 65536);
    assert.ok(four.includes('After Apply, each person gets at least <b>16k</b>'), four);
    assert.ok(four.includes('the 8 most relevant passages') && four.includes('that needs 24k each'));
    assert.ok(four.includes('class="warnline">Every connected Open WebUI restarts once'));
    assert.ok(four.includes('(clients newer than v0.2.7), Keep going until done writes replies of up to 8k, not 16k'), 'studio.ts agentMaxTokens(…, 16384, true) = 8192');
    // v0.2.7 asks 16k on any window: 16k + 4k of headroom leave dsh no trigger at 20k or less.
    assert.ok(four.includes('v0.2.7 and older still ask for 16k replies under Keep going, and at 20k each or less that leaves no room to summarise.'), four);
    // 8 at once on 64k → 8k each: a plain reply and 4k of headroom leave no room to summarise, on any client.
    const eight = edit(8, 65536);
    assert.ok(eight.includes('no room to summarise its history (a reply, 8k for most models, and 4k kept free fill the window)') && !eight.includes('v0.2.7'), eight);
    // 6 at once on 80k → 13653 each: Keep going falls back to plain replies, 1365 left before summarising.
    const six = edit(6, 81920);
    assert.ok(six.includes('<b>13653</b>') && six.includes('writes plain replies') && six.includes('leave 1365 for the conversation'), six);
    assert.ok(six.includes('v0.2.7 and older still ask for 16k'));
    // Back to 2 at once: no edit, no warning.
    assert.ok(!edit(2, 65536).includes('warnline') && edit(2, 65536).startsWith('<div class="hint">Each person'));
    // The hard split says so; 24k each sits on the client's line and keeps whole documents.
    const split = render(lcState({ backend: { ...lcState().backend, kvUnified: false } }));
    assert.ok(split.includes('<b>32k</b> of context: 64k split across 2'));
    const at24 = edit(4, 98304);
    assert.ok(at24.includes('<b>24k</b>') && at24.includes('reads attached documents whole') && !at24.includes('restarts once'));
    assert.ok(at24.includes('up to 14k, not 16k'), 'agentMaxTokens(…, 24576, true) = 14336');
    assert.ok(!at24.includes('v0.2.7 and older'), 'above 20k each a v0.2.7 client still summarises');
    // A 1M-native model at 1 slot: the option is offered, and the agent plans for 256k of it.
    const big = render(lcState({ fit: { nativeMax: 1048576, maxContext: 1048576, vramGb: 96, needGb: 40 } }));
    assert.ok(big.includes('<option value="1048576"'), 'the model\'s own max is on the menu');
    const oneM = edit(1, 1048576);
    assert.ok(oneM.includes('<b>1M</b> of context') && oneM.includes('(clients newer than v0.2.7) uses 256k of it at most'), oneM);
    // llama.cpp Automatic: slots do not enter it, the restart measures the GPU again.
    render(lcState({ llamacpp: { ...lcState().llamacpp, contextLength: 'auto', contextResolved: 131072 } }));
    const auto = edit(4, 'auto');
    assert.ok(auto.includes('at least <b>32k</b>') && auto.includes('can come out a little different'), auto);
    // A pinned window switched to Automatic with no fit (weights not on disk): no number is invented.
    render(lcState());
    const lcPending = edit(2, 'auto');
    assert.ok(lcPending.includes('not known yet') && lcPending.includes('sized at the restart'), lcPending);

    // Ollama: every request gets the whole window, whatever the slots.
    const ol = render(adminState());
    assert.ok(ol.includes('Each person gets <b>32k</b> of context: Ollama gives every request the whole window.'));
    assert.ok(!ol.includes('every request gets the full window'), 'the Ollama row no longer restates what the line says');
    // One Apply that changes the slots and measures Automatic files the verdict under the count the daemon RUNS
    // (ensureOllama reports it), so the restart re-measures for the new count instead of reusing it (up.js).
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(/const cacheKey = `[^`]*\|\$\{oll\.numParallel\}\|/.test(upSrc), 'the Ollama context cache key uses the running count');
    assert.ok(upSrc.includes('numParallel: config.ollama.numParallel };'), 'ensureOllama reports the count it started the daemon with');
    // Ollama holds people × window: more people at once can shrink Automatic, fewer can grow it.
    assert.ok(edit(4, 'auto').includes('sized again for 4 at once when the farm restarts, and can come out smaller'));
    assert.ok(edit(1, 'auto').includes('sized again for 1 at once when the farm restarts, and can come out larger'));
    // A pinned window switched to Automatic: measured on Apply — no number is invented.
    render(adminState({ ollama: { ...adminState().ollama, contextLength: 16384, contextResolved: 16384 } }));
    const pending = edit(2, 'auto');
    assert.ok(pending.includes('not known yet') && pending.includes('measured when you apply') && !pending.includes('<b>16k</b> of context'), pending);
    assert.ok(!pending.includes('sized again'));
    // With new slots in the same Apply, the measurement is the running daemon's (up.js keys it so)
    // and the restart sizes the new number.
    assert.ok(edit(4, 'auto').includes('measured when you apply, by loading the model a few times, and sized again for 4 at once when the farm restarts.'));

    // An external server: nothing to edit; the declared values, the same consequences.
    const ext = render(adminState({
        backend: { engine: 'external', alias: 'assistant', model: 'qwen3.6', baseUrl: 'http://127.0.0.1:8100/v1', contextLength: 65536, contextPerSlot: 65536, contextAuto: false, slots: 48, slotsVerified: false },
        capacity: { slots: 48, clients: 0, seats: [], seatIdleSec: 900, slotsVerified: false, unmanagedHosts: [], ollamaEnvAdvice: null },
    }));
    assert.ok(ext.includes('Each person gets <b>64k</b> of context, as that server was set up.'), 'plain words, no config key (D10)');
    assert.ok(ext.includes('reads attached documents whole') && !ext.includes('Keep going until done'));
});

test('panel: the client rules the line quotes are the shell\'s', () => {
    const shell = path.join(__dirname, '..', '..', 'shell');
    if (!fs.existsSync(shell)) return;   // a farm-only copy (the Farm app ships farm/ alone)
    const read = (...p) => fs.readFileSync(path.join(shell, ...p), 'utf8');
    const bridge = read('src', 'main', 'configBridge.ts');
    const studio = read('src', 'main', 'studio.ts');
    const models = read('renderer', 'chat', 'projects', 'models.mjs');
    const num = (src, rx) => { const m = rx.exec(src); assert.ok(m, `${rx} not found in the shell — re-check the panel's CLIENT`); return Number(m[1]); };
    const want = {
        fullDocs: num(bridge, /FULL_CONTEXT_MIN_CTX = (\d+)/),
        topK: num(bridge, /RAG_TOP_K: '(\d+)'/),
        agentMax: num(studio, /Math\.min\((\d+), Math\.max\(1024, Math\.floor\(n\)\)\)/),
        goalReply: num(studio, /GOAL_MAX_TOKENS = (\d+)/),
        headroom: num(studio, /COMPACT_HEADROOM = (\d+)/),
        plainReply: num(models, /\{ edits: 'unknown', maxTokens: (\d+), measured: '' \}/),
    };
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
    const m = /const CLIENT = (\{[^}]*\});/.exec(html);
    assert.ok(m, 'the panel\'s CLIENT moved');
    assert.deepEqual(new Function(`return ${m[1]};`)(), want);
    // The shapes the line restates: the clients' gate, and Keep going's 3/4-of-the-window replies.
    assert.ok(bridge.includes('input.contextPerSlot == null || input.contextPerSlot >= FULL_CONTEXT_MIN_CTX'));
    assert.ok(studio.includes('Math.min(GOAL_MAX_TOKENS, Math.floor(window * 3 / 4) - COMPACT_HEADROOM)'));
});

test('seat gate: its own 401, 429 and 502 are readable from another origin, and the 429 says honestly when a seat can free', async () => {
    const http = require('http');
    // A port nothing listens on: what the gate lets through gets the gate's own 502.
    const dead = http.createServer();
    await new Promise((r) => dead.listen(0, '127.0.0.1', r));
    const deadPort = dead.address().port;
    await new Promise((r) => dead.close(r));
    let retrySec = null;
    const seats = { admit: () => ({ ok: false, cap: 50, used: 50, retrySec }), release: () => {}, view: () => [] };
    const gate = await seatsMod.startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: deadPort, seats, idleReleaseSec: () => 600, password: () => 'pw' });
    const ask = (method, p, headers = {}) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: gate.address().port, method, path: p, headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:5555', ...headers } }, (res) => {
            let buf = '';
            res.on('data', (c) => { buf += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
        });
        req.on('error', reject);
        req.end(method === 'POST' ? '{"messages":[]}' : undefined);
    });
    try {
        const wrongKey = await ask('POST', '/v1/chat/completions', { authorization: 'Bearer nope' });
        const full = await ask('POST', '/v1/chat/completions', { authorization: 'Bearer pw' });
        const down = await ask('GET', '/v1/models');
        assert.deepEqual([wrongKey.status, full.status, down.status], [401, 429, 502]);
        // An agent page (the Preview, another origin) read only "Failed to fetch" without these.
        for (const r of [wrongKey, full, down]) {
            assert.equal(r.headers['access-control-allow-origin'], '*', `${r.status}: LiteLLM's own answers carry the same`);
            assert.equal(r.headers['access-control-expose-headers'], 'Retry-After', `${r.status}: the page may read Retry-After`);
        }
        // Every seat generating: none can free sooner than the idle window after its holder's last reply.
        assert.equal(full.headers['retry-after'], '600', 'the idle window, not a 30 s poll');
        assert.equal(JSON.parse(full.body).error.message, 'All 50 seats on this server are in use. Every one is generating right now, and a seat frees about 10 min after its holder\'s last reply: try again later. Whoever runs the farm can free idle seats sooner.');
        // An idle seat: when it frees, if its holder stays quiet. Nobody "in a moment", nobody asked to give a seat back.
        retrySec = 40;
        const idle = await ask('POST', '/v1/chat/completions', { authorization: 'Bearer pw' });
        assert.equal(idle.headers['retry-after'], '40');
        assert.equal(JSON.parse(idle.body).error.message, 'All 50 seats on this server are in use. The next one frees in about 40 s if its holder stays quiet: try again then. Whoever runs the farm can free idle seats sooner.');
    } finally {
        gate.close();
    }
});

// ---- the reply limit (proxy.maxReplyTokens) ------------------------------------
test('reply limit: a request naming no max_tokens gets 32768 on Ollama and llama.cpp, vLLM gets it from serve.sh', () => {
    const c = defaultConfig();
    assert.equal(c.proxy.maxReplyTokens, 32768);
    c.llamacpp.enabled = false;
    c.ollama.hosts = ['http://a:11434', 'http://b:11434'];
    // Every Ollama host carries it as a default (the request's own max_tokens wins: test/litellm-cancel.js);
    // a coordinator peer does not: its own farm sets its own.
    const doc = buildLitellmConfig(c, [{ openaiBaseUrl: 'http://peer:4000/v1', models: [] }]);
    assert.deepEqual(doc.model_list.map((d) => d.litellm_params.max_tokens), [32768, 32768, undefined]);
    c.llamacpp.enabled = true;
    assert.equal(buildLitellmConfig(c).model_list[0].litellm_params.max_tokens, 32768);
    // vLLM refuses a prompt plus max_tokens past its window, so the external server gets none from LiteLLM…
    c.external.enabled = true;
    assert.ok(!('max_tokens' in buildLitellmConfig(c).model_list[0].litellm_params));
    // (Qwen3.6's presence_penalty rides the same way, only when the operator declares it.)
    assert.ok(!('presence_penalty' in buildLitellmConfig(c).model_list[0].litellm_params));
    c.external.presencePenalty = 1.5;
    assert.equal(buildLitellmConfig(c).model_list[0].litellm_params.presence_penalty, 1.5);
    // … and serve.sh gives vLLM the same number as its own default (it cannot read lol.config.json).
    const serve = fs.readFileSync(path.join(__dirname, '..', 'vllm', 'serve.sh'), 'utf8');
    assert.ok(serve.includes(`--override-generation-config '{"max_new_tokens": ${c.proxy.maxReplyTokens}}'`));
    c.external.enabled = false;
    c.proxy.maxReplyTokens = null;   // the operator's "no limit"
    assert.ok(buildLitellmConfig(c).model_list.every((d) => !('max_tokens' in d.litellm_params)));
    assert.equal(ConfigSchema.safeParse({ proxy: { maxReplyTokens: 100 } }).success, false, 'too small to finish a thought');
});

// ---- the capacity explorer (/lol/capacity) ---------------------------------------
test('capacity explorer: /lol/capacity serves its page, scripts and data, open, and asks nothing off the farm', async () => {
    // No admin control: the page stays open, like /lol/self (it holds no secret and changes nothing).
    const server = startSelfServer({ httpPort: 0, getSnapshot: () => ({ name: 'T' }), host: '127.0.0.1' });
    await new Promise((r) => { if (server.listening) r(); else server.once('listening', r); });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const page = await fetch(`${base}/lol/capacity`);
        assert.equal(page.status, 200);
        assert.match(page.headers.get('content-type'), /^text\/html/);
        const html = await page.text();
        assert.ok(!/https?:\/\//i.test(html), 'no outside address (fonts, CDN): the page must work on a farm cut off from the internet');
        // Everything it loads comes from this server, with its type.
        const refs = [...new Set([...html.matchAll(/(?:src="|get\(')(\/lol\/capacity\/[^"']+)/g)].map((m) => m[1]))].sort();
        assert.deepEqual(refs, ['/lol/capacity/catalog.json', '/lol/capacity/estimator.js', '/lol/capacity/measured.json', '/lol/capacity/scenarios.js']);
        for (const ref of refs) {
            const r = await fetch(base + ref);
            assert.equal(r.status, 200, ref);
            const body = await r.text();
            if (ref.endsWith('.json')) { assert.equal(r.headers.get('content-type'), 'application/json', ref); JSON.parse(body); }
            else { assert.match(r.headers.get('content-type'), /^text\/javascript/, ref); assert.ok(!/https?:\/\//i.test(body), `${ref} names no outside address`); }
        }
        assert.equal((await fetch(`${base}/lol/capacity/`)).status, 200, 'a trailing slash still finds the page');
        assert.equal((await fetch(`${base}/lol/capacity/selfServer.js`)).status, 404, 'a fixed list of files, not a folder');
        assert.ok(html.includes('href="/lol/admin"'), 'the page links back to the panel');
    } finally {
        server.close();
    }
    // The panel links to it in a new tab, which the Farm app opens in the system browser.
    const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
    assert.ok(admin.includes('href="/lol/capacity" target="_blank"'), 'the panel links to the explorer');
    const farmApp = path.join(__dirname, '..', '..', 'farm-app');
    if (fs.existsSync(farmApp)) {   // a farm-only copy (the Farm app ships farm/ alone)
        assert.ok(/<webview id="admin"[^>]*\ballowpopups\b/.test(fs.readFileSync(path.join(farmApp, 'renderer', 'index.html'), 'utf8')),
            'without allowpopups Electron drops the panel\'s new-tab links before any handler sees them');
        assert.ok(/'web-contents-created'[^\n]*'webview'[^\n]*openLinksOutside/.test(fs.readFileSync(path.join(farmApp, 'src', 'main', 'index.ts'), 'utf8')),
            'the Farm app sends the webview\'s new-tab links to the system browser');
    }
});

test('capacity scenarios: needs filter the models, the picks cover the head count with room to spare, the answers are sane and stable', () => {
    const dir = path.join(__dirname, '..', 'src', 'capacity');
    const E = require(path.join(dir, 'estimator.js'));
    const Sc = require(path.join(dir, 'scenarios.js'));
    const cat = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
    E.init(cat, JSON.parse(fs.readFileSync(path.join(dir, 'measured.json'), 'utf8')));
    const model = (id) => cat.models.find((m) => m.id === id);
    const card = (id) => Sc.card(Sc.SCENARIOS.find((s) => s.id === id));
    const run = (id, hwId) => Sc.recommend(E, cat, card(id), { hwId });
    const names = (res) => res.picks.map((p) => `${p.model.id}@${p.hw.id}`);

    // Needs. The coding agent: tool calling and a strong agentic-coding score (Nemotron's SWE-bench Verified 52.8
    // and Gemma 4 26B's 17.4 are under the bar). A class sends pictures. Long documents: 128k and a good model.
    const coding = card('xr').need;
    assert.equal(Sc.unmet(model('nemotron-3.5-lightning-30b-a3b'), coding), 'no strong agentic-coding score');
    assert.equal(Sc.unmet(model('gemma-4-26b-a4b'), coding), 'no strong agentic-coding score');
    assert.equal(Sc.unmet(model('qwen3.6-35b-a3b'), coding), null);
    assert.equal(Sc.unmet(model('qwen3.8-27b'), coding), null);
    assert.equal(Sc.unmet({ ...model('qwen3.6-35b-a3b'), tools: false }, coding), 'no tool calling');
    assert.equal(Sc.unmet(model('nemotron-3.5-lightning-30b-a3b'), card('class').need), 'cannot read images');
    assert.equal(Sc.unmet({ ...model('qwen3.6-35b-a3b'), context_native: 65536 }, card('reports').need), 'reads at most 64k');
    assert.equal(Sc.unmet(model('gpt-oss-120b'), card('reports').need), 'a weaker model than this needs');

    const all = Sc.SCENARIOS.map((s) => run(s.id));
    for (const res of all) {
        const sc = res.scenario, n = sc.people;
        assert.ok(res.picks.length >= 1 && res.picks.length <= 3, `${sc.id}: 1-3 picks`);
        assert.equal(new Set(res.picks.map((p) => p.hw.id)).size, res.picks.length, `${sc.id}: one pick per box`);
        for (const p of res.picks) {
            const at = `${sc.id}: ${p.model.id}@${p.hw.id}`;
            assert.ok(p.r.people.low >= n && p.r.people.mid >= Math.ceil(n * 1.2), `${at} covers ${n} with room to spare`);
            assert.equal(Sc.unmet(p.model, sc.need), null, `${at} meets the needs`);
            if (n > 2) assert.ok(!p.r.checkpoint.gguf, `${at}: llama.cpp-only pairs never carry more than two people`);
            if (n > 2) assert.ok(!/single-person/i.test(p.hw.name), `${at}: a single-person GeForce card never carries a group`);
            assert.ok(/^Covers your \d+ with \d+/.test(p.reason) && p.reason.includes(p.r.confidence), `${at} says why, and how sure`);
        }
        const key = sc.rank === 'quality' ? (p) => -(Sc.score(p.model) ?? -1) : (p) => p.hw.price_eur_ttc || Infinity;
        res.picks.forEach((p, i) => i && assert.ok(key(res.picks[i - 1]) <= key(p), `${sc.id}: ranked by ${sc.rank}`));
    }
    // Documents with 5: the cheapest box that serves 5 with room to spare is one DGX Spark, measured.
    const rag = all[0];
    assert.equal(names(rag)[0], 'qwen3.6-35b-a3b@dgx-spark');
    assert.equal(rag.picks[0].r.confidence, 'measured');
    // A class of 30: no Spark, and the card says why; the studio's PRO 6000 covers it with Qwen3.6, measured.
    const cls = run('class', 'rtx-pro-6000-ws');
    assert.ok(!cls.picks.some((p) => p.hw.id.startsWith('dgx-spark')));
    assert.ok(cls.whyNot.some((w) => w.hw.id === 'dgx-spark' && /not your 30/.test(w.text)), 'why not a Spark');
    assert.equal(cls.thisFarm.model.id, 'qwen3.6-35b-a3b');
    assert.ok(cls.thisFarm.covers && cls.thisFarm.r.confidence === 'measured');
    // Vibe-coding with 10 on a Spark farm: this farm falls short (measured 8 at 64k), and says so.
    const xr = run('xr', 'dgx-spark');
    assert.equal(xr.thisFarm.model.id, 'qwen3.6-35b-a3b');
    assert.ok(!xr.thisFarm.covers && /not your 10/.test(xr.thisFarm.reason));
    // The Computer on a Spark: Nemotron, the head-count model (plan §8's golden case). And where several models
    // cover the workshop (the PRO 6000: Qwen3.8, Qwen3.6, Nemotron), it still takes the one serving the most.
    assert.equal(run('workshop', 'dgx-spark').thisFarm.model.id, 'nemotron-3.5-lightning-30b-a3b');
    assert.equal(run('workshop', 'rtx-pro-6000-ws').thisFarm.model.id, 'nemotron-3.5-lightning-30b-a3b');
    // ... and says what it cannot do: Nemotron reads no images.
    assert.ok(/cannot read images/.test(run('workshop', 'dgx-spark').thisFarm.reason));
    // What the farm serves now comes first on its own box when it covers the head count (the PRO 6000 on Qwen3.6).
    const served = Sc.recommend(E, cat, card('workshop'), { hwId: 'rtx-pro-6000-ws', servedId: 'qwen3.6-35b-a3b' }).thisFarm;
    assert.ok(served.served && served.model.id === 'qwen3.6-35b-a3b' && served.covers);
    // ... but not when it falls short (vibe-coding with 10 on a Spark: the best there is shown, not served).
    assert.ok(!Sc.recommend(E, cat, card('xr'), { hwId: 'dgx-spark', servedId: 'qwen3.6-35b-a3b' }).thisFarm.served);
    // A GeForce farm with 20 people: the card says it is a one-person card, not a covering pick.
    const g = run('workshop', 'rtx-5090').thisFarm;
    assert.ok(g && !g.covers && /one person/.test(g.reason), g && g.reason);
    // A 12 GB card: nothing fits it on vLLM, so it says what llama.cpp would do and that it is not enough.
    const small = run('rag', 'rtx-4070').thisFarm;
    assert.ok(small.llama && !small.covers && /llama\.cpp/.test(small.reason));
    // Stable: the same answers twice.
    assert.deepEqual(Sc.SCENARIOS.map((s) => names(run(s.id))), all.map(names));
    // Your own: the use's needs and inputs, with the person's head count and way of working.
    const own = Sc.scenario('coding', 3, 'every');
    assert.deepEqual([own.people, own.est.mode, own.est.context, own.need.tools], [3, 'every', 65536, true]);

    // This farm: the GPU nvidia-smi names maps to its catalog box; an unknown one to the largest box with no more memory.
    const hw = (gpu, vramGb) => Sc.matchHardware(cat, { gpu, vramGb });
    assert.deepEqual(hw('NVIDIA GB10', 119), { id: 'dgx-spark', exact: true, gpu: 'NVIDIA GB10', vramGb: 119 });
    assert.equal(hw('NVIDIA RTX PRO 6000 Blackwell Workstation Edition', 96).id, 'rtx-pro-6000-ws');
    assert.equal(hw('NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition', 96).id, 'rtx-pro-6000-maxq');
    assert.equal(hw('NVIDIA RTX PRO 5000 Blackwell', 72).id, 'rtx-pro-5000-72');
    assert.equal(hw('NVIDIA GeForce RTX 4070', 12).id, 'rtx-4070');
    assert.equal(hw('NVIDIA GeForce RTX 4070 Ti SUPER', 16).exact, false, 'a 16 GB 4070 is not the 12 GB catalog card');
    assert.deepEqual(hw('NVIDIA RTX A6000', 48), { id: 'rtx-pro-5000-48', exact: false, gpu: 'NVIDIA RTX A6000', vramGb: 48 });
    assert.equal(hw('Unknown GPU', 0), null);
    // ... and the model it serves to its catalog entry, whatever the engine calls it.
    assert.equal(Sc.matchModel(cat, 'gemma4:12b').id, 'gemma-4-12b');
    assert.equal(Sc.matchModel(cat, 'nvidia/Qwen3.6-35B-A3B-NVFP4').id, 'qwen3.6-35b-a3b');
    assert.equal(Sc.matchModel(cat, 'Qwen3.8-27B-UD-IQ2_S').id, 'qwen3.8-27b');
    assert.equal(Sc.matchModel(cat, 'nemotron-3.5-lightning:30b').id, 'nemotron-3.5-lightning-30b-a3b');
    assert.equal(Sc.matchModel(cat, 'assistant'), null);
});

// ---- vLLM run by the farm (docs/VLLM_MANAGED_PLAN.md §11.1, items 1-14) ------------------------------------
const V = require('../src/vllm');
const { engineOf } = require('../src/litellm');
const FIX = path.join(__dirname, 'fixtures');
const GIB = 2 ** 30;
const PRO = 'NVIDIA RTX PRO 6000 Blackwell Workstation Edition';
// The production box's operator-run vLLM, as its lol.config.json declared it on 2026-10-07 (the external block).
const PROD_EXTERNAL = { enabled: true, alias: 'Qwen3.6', baseUrl: 'http://127.0.0.1:8100/v1', model: 'qwen3.6-35b-a3b', contextLength: 65536, parallel: 48, vision: true, label: 'Qwen3.6-35B-A3B (vLLM)', presencePenalty: 1.5 };
// What the take-over (§9.3) builds from it: the same model, name and settings, now run by the farm.
function takeOverConfig() {
    const c = defaultConfig();
    Object.assign(c.vllm, { enabled: true, root: '/home/ateliernum/lol-spike', port: 8100, alias: 'Qwen3.6', model: 'qwen3.6-35b-a3b', contextLength: 65536, parallel: 48, kvCacheGib: 50 });
    return c;
}
// serve.sh's own ARGS block (the operator's path), as `vllm serve` receives it: read from the script, so the
// adoption test and the script cannot drift apart.
function serveShArgv(root) {
    const sh = fs.readFileSync(path.join(__dirname, '..', 'vllm', 'serve.sh'), 'utf8');
    const block = /\nARGS=\(\n([\s\S]*?)\n\)\n/.exec(sh)[1];
    const words = [];
    for (const line of block.split('\n')) {
        for (const m of line.replace(/(^|\s)#.*$/, '').matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)) words.push(m[1] ?? m[2] ?? m[3]);
    }
    const folder = /MODEL="\$\{LOL_VLLM_MODEL:-\$ROOT\/hf\/([^}]+)\}"/.exec(sh)[1];
    return [`${root}/hf/${folder}`, ...words.map((w) => w.replace('$SOCK', `${root}/run/vllm.sock`))];
}
const serveOn = (c, e) => { c.llamacpp.enabled = e === 'llamacpp'; c.vllm.enabled = e === 'vllm'; c.external.enabled = e === 'external'; };

test('vLLM config: its defaults, the three measured models, and what it refuses (§11.1-1)', () => {
    const v = defaultConfig().vllm;
    assert.deepEqual(
        { ...v, library: undefined },
        { enabled: false, root: null, distro: null, port: 8100, alias: 'assistant', model: 'qwen3.6-35b-a3b', contextLength: 65536, parallel: 'auto', maxNumSeqs: 'auto', kvCacheGib: 'auto', ocrReserveGib: 9, marginPct: 8, minFreeGb: 'auto', version: '0.30.0', extraArgs: [], library: undefined },
    );
    assert.deepEqual(v.library.map((e) => [e.id, e.repo, e.vision, e.presencePenalty, e.measured]), [
        ['qwen3.6-35b-a3b', 'nvidia/Qwen3.6-35B-A3B-NVFP4', true, 1.5, 'qwen36'],
        ['nemotron-3.5-lightning', 'nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4', false, null, 'nemotron'],
        ['qwen3.8-27b-nvfp4', 'nvidia/Qwen3.8-27B-NVFP4', true, null, 'qwen38'],
    ]);
    assert.equal(v.library[0].args.join(' '), '--kv-cache-dtype fp8 --enable-prefix-caching --mamba-cache-mode align --reasoning-parser qwen3 --enable-auto-tool-choice --tool-call-parser qwen3_xml', 'the spike\'s flags, as serve.sh runs them');
    assert.ok(defaultConfig().vllm.library[0].args !== v.library[0].args, 'each config gets its own copy of the library');
    const ok = (vllm) => ConfigSchema.safeParse({ vllm }).success;
    assert.ok(!ok({ bogus: 1 }), 'strict: an unknown key in the block');
    assert.ok(!ok({ library: [{ id: 'a', label: 'A', bogus: 1 }] }), 'strict: an unknown key in a model');
    for (const id of ['Qwen', '-a', 'a b', 'a/b', 'x'.repeat(65)]) assert.ok(!ok({ library: [{ id, label: 'x' }] }), `id ${id}`);
    assert.ok(ok({ library: [{ id: 'qwen3-0.6b_x', label: 'x', folder: 'Qwen3-0.6B', repo: 'Qwen/Qwen3-0.6B' }] }));
    assert.ok(!ok({ library: [{ id: 'a', label: 'x', folder: '../etc' }] }) && !ok({ library: [{ id: 'a', label: 'x', repo: 'no-owner' }] }));
    for (const root of ['~', '~/lol-vllm', '/home/me/lol-vllm', '/srv/a.b/c-d']) assert.ok(ok({ root }), root);
    for (const root of ['lol-vllm', '/home/me/../root', '~/..', '/a/./b', '/a b', '~user/x', 'C:\\vllm', '/a/']) assert.ok(!ok({ root }), root);
    assert.ok(ok({ parallel: 1 }) && ok({ parallel: 512 }) && !ok({ parallel: 0 }) && !ok({ parallel: 513 }) && !ok({ parallel: 'many' }));
    assert.ok(ok({ kvCacheGib: 1 }) && ok({ kvCacheGib: 'auto' }) && !ok({ kvCacheGib: 0.5 }));
    assert.ok(ok({ contextLength: 4096 }) && !ok({ contextLength: 4095 }));
    assert.ok(ok({ minFreeGb: 0 }) && !ok({ minFreeGb: -1 }) && !ok({ distro: 'Ubuntu 24' }));
});

test('engineOf: external > vLLM > llama.cpp > Ollama over every combination, with or without a vllm block (§11.1-2)', () => {
    for (let i = 0; i < 16; i++) {
        const c = defaultConfig();
        c.external.enabled = !!(i & 1); c.vllm.enabled = !!(i & 2); c.llamacpp.enabled = !!(i & 4);
        if (i & 8) delete c.vllm;   // a config from before vLLM was an engine
        const want = c.external.enabled ? 'external' : (c.vllm && c.vllm.enabled) ? 'vllm' : c.llamacpp.enabled ? 'llamacpp' : 'ollama';
        assert.equal(engineOf(c), want, `combination ${i}`);
        assert.equal(ollamaServes(c), want === 'ollama', `combination ${i}`);
    }
});

test('vLLM route: hosted_vllm to serve.sh\'s relay, the model\'s presence penalty and vision, no reply cap, no Ollama, peers (§11.1-3)', () => {
    const c = defaultConfig();
    c.vllm.enabled = true;
    let doc = buildLitellmConfig(c);
    assert.equal(doc.model_list.length, 1, 'no Ollama deployment beside it');
    const [d] = doc.model_list;
    assert.equal(d.model_name, 'assistant');
    assert.deepEqual(d.litellm_params, { model: 'hosted_vllm/qwen3.6-35b-a3b', api_base: 'http://127.0.0.1:8100/v1', api_key: 'sk-lol-vllm', presence_penalty: 1.5 });
    assert.deepEqual(d.model_info, { supports_vision: true });
    assert.equal(doc.router_settings.disable_cooldowns, true, 'alone: nothing to fail over to');
    c.vllm.model = 'nemotron-3.5-lightning'; c.vllm.port = 8299;
    doc = buildLitellmConfig(c);
    assert.deepEqual(doc.model_list[0].litellm_params, { model: 'hosted_vllm/nemotron-3.5-lightning', api_base: 'http://127.0.0.1:8299/v1', api_key: 'sk-lol-vllm' });
    assert.ok(!('model_info' in doc.model_list[0]), 'Nemotron does not see images');
    // A model whose vision the checkpoint says (null in the list): what the farm read from its folder.
    c.vllm.library.push({ ...c.vllm.library[1], id: 'mine', vision: null }); c.vllm.model = 'mine';
    assert.ok(!('model_info' in buildLitellmConfig(c).model_list[0]));
    c.vllm.visionResolved = true;
    assert.deepEqual(buildLitellmConfig(c).model_list[0].model_info, { supports_vision: true });
    // Coordinator peers serving the same name aggregate; the others do not.
    c.vllm.model = 'qwen3.6-35b-a3b';
    doc = buildLitellmConfig(c, [{ openaiBaseUrl: 'http://10.0.0.9:4000/v1', models: ['assistant'] }, { openaiBaseUrl: 'http://10.0.0.8:4000/v1', models: ['other'] }]);
    assert.deepEqual(doc.model_list.map((x) => x.litellm_params.model), ['hosted_vllm/qwen3.6-35b-a3b', 'openai/assistant']);
    assert.ok(!doc.router_settings.disable_cooldowns, 'two deployments: failover');
});

test('vLLM route, golden: the take-over\'s routing is production\'s external routing apart from api_key, so the take-over need not restart the proxy (§11.1-3)', () => {
    const ext = defaultConfig();
    Object.assign(ext.external, PROD_EXTERNAL);
    const managed = takeOverConfig();
    const a = toYaml(buildLitellmConfig(ext)); const b = toYaml(buildLitellmConfig(managed));
    assert.notEqual(a, b);
    assert.equal(b.replace('api_key: sk-lol-vllm', 'api_key: sk-lol-external'), a);
});

test('vLLM in the snapshot: the engine, its seats and window, its one name; healthy while it starts, not once stopped (§11.1-4)', () => {
    const c = defaultConfig();
    Object.assign(c.vllm, { enabled: true, alias: 'Qwen3.6', parallelResolved: 48 });
    const be = backendInfo(c, {});
    assert.deepEqual(be, { engine: 'vllm', alias: 'Qwen3.6', model: 'Qwen3.6 35B-A3B · NVFP4', contextLength: 65536, contextAuto: false, contextPerSlot: 65536, slots: 48, slotsVerified: true, mtp: false, kvCacheType: 'fp8' });
    delete c.vllm.parallelResolved;
    assert.equal(backendInfo(c, {}).slots, 4, 'Automatic, before it is worked out');
    c.vllm.parallel = 12;
    assert.equal(backendInfo(c, {}).slots, 12);
    c.vllm.parallelResolved = 48;
    const job = { kind: 'engine', label: 'Starting vLLM', message: 'reading the model', percent: null, done: false };
    const starting = buildSnapshot(c, { proxyUp: true, engineUp: true, getJob: () => job });
    assert.deepEqual(starting.models, [{ id: 'Qwen3.6', underlying: 'Qwen3.6 35B-A3B · NVFP4', default: true }], 'one model; the Ollama catalog is standby');
    assert.equal(starting.healthy, true, 'a planned start keeps clients on this farm');
    assert.deepEqual(starting.busy, { kind: 'engine', label: 'Starting vLLM', message: 'reading the model', percent: null });
    assert.equal(starting.capacity.slots, 48);
    for (const [why, getJob] of [['stopped', () => null], ['the memory guard', () => null], ['the restart after a crash', () => ({ ...job, label: 'Restarting vLLM after it stopped unexpectedly' })]]) {
        assert.equal(buildSnapshot(c, { proxyUp: true, engineUp: false, getJob }).healthy, false, `${why}: clients go elsewhere`);
    }
    // The contract carries both: starting (healthy, busy) and serving.
    const ex = contractExamples().filter((e) => e.snap.backend.engine === 'vllm');
    assert.deepEqual(ex.map((e) => [e.snap.healthy, e.snap.busy && e.snap.busy.label]), [[true, 'Starting vLLM'], [true, null]]);
});

test('names move across all four engines: the name chats are bound to survives every switch (§11.1-5)', () => {
    const E = ['ollama', 'llamacpp', 'vllm', 'external'];
    const own = { llamacpp: 'lc-name', vllm: 'vl-name', external: 'ex-name' };
    const defId = (c) => buildSnapshot(c, {}).models.find((m) => m.default).id;
    const variants = {
        'a per-model Ollama name': (c) => { c.models = [{ id: 'gemma4:12b', default: true, alias: 'tutor' }, { id: 'qwen3:8b' }]; },
        'the global Ollama name': (c) => { c.modelAlias = 'helper'; },
        'an unnamed Ollama default': () => {},
    };
    let n = 0;
    for (const [vname, setup] of Object.entries(variants)) {
        for (const from of E) {
            for (const to of E) {
                const c = defaultConfig(); setup(c);
                for (const e of Object.keys(own)) c[e].alias = own[e];
                serveOn(c, from);
                const before = defId(c); const frozen = JSON.stringify(c);
                const plan = carryNameAcross(c, from, to);
                assert.equal(JSON.stringify(c), frozen, 'carryNameAcross is pure');
                if (from === to) { assert.deepEqual(plan, {}); continue; }
                applyNamePlan(c, plan); serveOn(c, to);
                if (from === 'ollama' && before === 'gemma4:12b') assert.equal(defId(c), own[to], `${vname}: ${from} → ${to}: a raw checkpoint id is not carried`);
                else assert.equal(defId(c), before, `${vname}: ${from} → ${to} keeps "${before}"`);
                if (from === 'ollama') assert.equal(c.modelAlias ?? null, null, 'the serving engine holds the one name');
                n++;
            }
        }
    }
    assert.equal(n, 36);
    // Never two models under one name: another catalog model already answers to it.
    const c = defaultConfig();
    c.models = [{ id: 'gemma4:12b', default: true }, { id: 'qwen3:8b', alias: 'vl-name' }];
    c.vllm.alias = 'vl-name'; serveOn(c, 'vllm');
    assert.deepEqual(carryNameAcross(c, 'vllm', 'ollama'), {});
});

test('a vLLM that cannot serve falls back to Ollama under its name, in memory only; an external server falls to vLLM first (§11.1-5)', () => {
    const snapId = (c) => buildSnapshot(c, {}).models.find((m) => m.default).id;
    let c = defaultConfig();
    Object.assign(c.vllm, { enabled: true, alias: 'Qwen3.6' }); c.llamacpp.enabled = true;
    assert.deepEqual(engineFallback(c, 'vllm'), { modelAlias: 'Qwen3.6' });
    assert.equal(engineOf(c), 'ollama', 'Ollama, never llama.cpp');
    assert.equal(snapId(c), 'Qwen3.6');
    c = defaultConfig();
    Object.assign(c.vllm, { enabled: true, alias: 'Qwen3.6' });
    c.models = [{ id: 'gemma4:12b', default: true, alias: 'tutor' }];
    assert.deepEqual(engineFallback(c, 'vllm'), {}, 'the operator\'s own Ollama name wins');
    c = defaultConfig();
    Object.assign(c.external, { enabled: true, alias: 'deepseek' }); c.vllm.enabled = true;
    assert.deepEqual(engineFallback(c, 'external'), { vllmAlias: 'deepseek' });
    assert.equal(engineOf(c), 'vllm');
    assert.equal(snapId(c), 'deepseek');
    engineFallback(c, 'vllm');
    assert.equal(snapId(c), 'deepseek', 'and Ollama after it, still under the name chats are bound to');
});

test('vLLM launch: the farm\'s whole argv, its environment, and how a script runs on Windows and Linux (§11.1-6)', () => {
    const st = V.parseStatus(['home=/home/me', 'arch=x86_64', `gpu=${PRO}, 97887, 95272, 12.0`, 'mem_total_kb=98875528', 'mem_available_kb=91993964',
        'disk_free_kb=600000000', 'install=/home/me/lol-vllm 0.30.0', 'model=Qwen3.6-35B-A3B-NVFP4 22880000 vision=1 native=262144 partial=0'].join('\n'));
    const c = defaultConfig();
    c.vllm.enabled = true;
    const mem = { unified: false, totalGib: 95.59, freeGib: 93.04 };
    let p = V.planFor(c, st, mem);
    assert.ok(p.ok, p.reason);
    assert.equal(p.folderPath, '/home/me/lol-vllm/hf/Qwen3.6-35B-A3B-NVFP4');
    assert.deepEqual([p.seats, p.seatsSource, p.maxNumSeqs, p.kvGib, p.peopleFit], [48, 'measured', 128, 52, 69]);
    assert.deepEqual(p.argv, ['--served-model-name', 'qwen3.6-35b-a3b', '--max-model-len', '65536', '--max-num-seqs', '128', '--kv-cache-memory-bytes', String(52 * GIB),
        ...c.vllm.library[0].args, '--override-generation-config', '{"max_new_tokens":32768}']);
    assert.deepEqual(Buffer.from(p.env.LOL_VLLM_ARGS_B64, 'base64').toString('utf8').split('\0'), p.argv, 'serve.sh decodes exactly this');
    assert.deepEqual({ ...p.env, LOL_VLLM_ARGS_B64: undefined }, { LOL_VLLM_DAEMON: '1', LOL_VLLM_ROOT: '/home/me/lol-vllm', LOL_VLLM_PORT: '8100', LOL_VLLM_MODEL: p.folderPath, LOL_VLLM_ARGS_B64: undefined });
    c.proxy.maxReplyTokens = null; c.vllm.extraArgs = ['--enforce-eager'];
    p = V.planFor(c, st, mem);
    assert.ok(!p.argv.includes('--override-generation-config'), 'no reply limit: no override');
    assert.equal(p.argv[p.argv.length - 1], '--enforce-eager', 'the extra flags come last');
    // Unified memory (DGX Spark): the memory guard's 8 GB and 4 compile jobs.
    p = V.planFor(c, { ...st, gpu: { name: 'NVIDIA GB10', totalGib: null, freeGib: null, cap: 12.1 } }, { unified: true, totalGib: 119.2, memAvailableGib: 110 });
    // The pool is 59 GiB uncapped (poolGib, §6), then capped at what 32 requests at once can hold at 64k, plus 10 %.
    assert.deepEqual([p.env.LOL_VLLM_MIN_FREE_GB, p.env.MAX_JOBS, p.seats, p.maxNumSeqs, p.kvGib, p.kvWhy.capped], ['8', '4', 8, 32, 27, true]);
    // A model the list does not have, and an explicit pool under one person: refused with the reason.
    c.vllm.model = 'nope';
    assert.match(V.planFor(c, st, mem).reason, /is not in the vLLM list/);
    c.vllm.model = 'qwen3.6-35b-a3b'; c.vllm.kvCacheGib = 1; c.vllm.contextLength = 262144;
    assert.match(V.planFor(c, st, mem).reason, /less than one person's conversation needs/);
    // How a script runs: Windows through wsl.exe from farm\vllm's Windows path (a space in it), Linux with bash there.
    const dir = 'C:\\Users\\a b\\AppData\\Roaming\\LlmOnLan Farm\\farm\\vllm';
    const baseEnv = { PATH: 'p', ELECTRON_RUN_AS_NODE: '1', PYTHONHOME: 'h', LOL_PYTHON: 'x', PYTHONPATH: 'y' };
    const w = V.scriptCommand(c, 'serve.sh', { A: '1', B: 'x y' }, { platform: 'win32', distro: 'Ubuntu', dir, baseEnv });
    assert.deepEqual([w.cmd, w.args], ['wsl.exe', ['-d', 'Ubuntu', '--cd', dir, '-e', 'env', 'A=1', 'B=x y', 'bash', './serve.sh']]);
    assert.deepEqual(w.env, { PATH: 'p' }, 'the farm\'s Electron and Python variables stay out');
    assert.deepEqual(V.scriptCommand(c, 'stop.sh', {}, { platform: 'win32', distro: null, dir, baseEnv, args: ['install'] }).args, ['--cd', dir, '-e', 'env', 'bash', './stop.sh', 'install'], 'no distribution named: WSL\'s default');
    const l = V.scriptCommand(c, 'status.sh', { LOL_VLLM_ROOT: '/r' }, { platform: 'linux', dir: '/opt/farm/vllm', baseEnv });
    assert.deepEqual([l.cmd, l.args, l.cwd, l.env], ['bash', ['./status.sh'], '/opt/farm/vllm', { PATH: 'p', LOL_VLLM_ROOT: '/r' }]);
});

test('vLLM card: a press on vLLM before it is set up opens its card AND brings it into view (it opened below the Backend card, out of sight: the press looked like it did nothing, PRO 6000 2026-10-08)', () => {
    const p = loadPanel({ fetch: async () => ({ status: 200, json: async () => ({ ok: true }) }) });
    const s = ollamaWithVllm({ probe: { at: 1, oks: [], problems: ['vLLM is not installed on this computer yet: press Install vLLM.'], warnings: [], gpuTooSmall: false } });
    p(s);
    assert.ok(!p.el('#app').innerHTML.includes('id="vllm-card"'), 'closed before the press');
    p.engineClick(s, 'vllm', { dataset: {} });
    assert.ok(p.el('#app').innerHTML.includes('id="vllm-card"'), 'the card is drawn');
    assert.deepEqual(p.scrolled, ['vllm-card'], 'and scrolled to');
});

test('vLLM: a script missing from farm/vllm is said as such, before anything starts (the Farm app\'s update stopped half-way)', async () => {
    const r = await V.spawnScript({}, 'not-a-script.sh');   // resolved without a wsl.exe or a bash
    assert.equal(r.missing, 'not-a-script.sh');
    assert.match(r.error, /^A file of the farm is missing \(vllm\/not-a-script\.sh\): its last update did not finish\. Restart the farm/);
    for (const s of ['serve.sh', 'stop.sh', 'install.sh', 'status.sh']) {
        assert.ok(fs.existsSync(path.join(__dirname, '..', 'vllm', s)), `farm/vllm/${s} ships`);
    }
});

test('vLLM golden adoption: the take-over keeps the server production runs, read from serve.sh and lol-vllm.service themselves (§11.1-7)', () => {
    const running = { pgid: 401, port: 8100, minFreeGb: null, argv: serveShArgv('/home/ateliernum/lol-spike'), ready: true };
    assert.equal(running.argv.length, 23, 'serve.sh\'s ARGS block was read: the model and 22 words');
    const a = V.adoptable(takeOverConfig(), running, { unified: false, gpuName: PRO });
    assert.deepEqual(a, { ok: true, resolved: { kvGib: 50, maxNumSeqs: 128, seats: 48 }, diff: [] });
    // Automatic everywhere keeps it too (D9): the pool it holds is accepted, 67 people fit in it at 64k, the card's
    // measured 48 are the seats, and 48 seats ask for 128 at once.
    const auto = takeOverConfig();
    Object.assign(auto.vllm, { parallel: 'auto', kvCacheGib: 'auto' });
    assert.deepEqual(V.adoptable(auto, running, { gpuName: PRO }), { ok: true, resolved: { kvGib: 50, maxNumSeqs: 128, seats: 48 }, diff: [] });
    // An explicit setting that differs from the running server: not kept, and the diff says what.
    for (const [what, set, key] of [
        ['the pool', (v) => { v.kvCacheGib = 40; }, '--kv-cache-memory-bytes'],
        ['the context', (v) => { v.contextLength = 32768; }, '--max-model-len'],
        ['the model', (v) => { v.model = 'nemotron-3.5-lightning'; }, 'model'],
        ['the port', (v) => { v.port = 8101; }, 'port'],
        ['the seats', (v) => { v.parallel = 80; }, '--max-num-seqs'],
        ['the memory guard', (v) => { v.minFreeGb = 8; }, 'minFreeGb'],
    ]) {
        const c = takeOverConfig(); set(c.vllm);
        const r = V.adoptable(c, running, { gpuName: PRO });
        assert.equal(r.ok, false, what); assert.ok(r.diff.includes(key), `${what}: ${r.diff}`);
    }
    // The DGX Spark's unit: serve.sh's defaults plus the unit's overrides (the last value wins), its memory guard.
    const unit = fs.readFileSync(path.join(__dirname, '..', 'vllm', 'lol-vllm.service'), 'utf8');
    const extra = /^ExecStart=\S+ \S+serve\.sh (.*)$/m.exec(unit)[1].split(/\s+/);
    const floor = Number(/^Environment=LOL_VLLM_MIN_FREE_GB=(\d+)$/m.exec(unit)[1]);
    const spark = { pgid: 7, port: 8100, minFreeGb: floor, argv: [...serveShArgv('/home/me/lol-vllm'), ...extra], ready: true };
    const c = defaultConfig();
    Object.assign(c.vllm, { enabled: true, root: '/home/me/lol-vllm', contextLength: 65536, parallel: 8, kvCacheGib: 58 });
    assert.deepEqual(V.adoptable(c, spark, { unified: true, gpuName: 'NVIDIA GB10' }), { ok: true, resolved: { kvGib: 58, maxNumSeqs: 32, seats: 8 }, diff: [] });
    assert.ok(!V.adoptable(c, spark, { unified: false, gpuName: 'NVIDIA GB10' }).ok, 'its guard is not this farm\'s Automatic on a discrete GPU');
});

test('vLLM sizing: the pool, people per pool, Automatic seats and vLLM\'s own cap, on the measured boxes (§11.1-8, §6)', () => {
    const pro = { totalGib: 95.59, freeGib: 93.04, weightsGib: 20.37, ocrReserveGib: 9, marginPct: 8 };
    assert.equal(V.poolGib(pro).gib, 52, 'RTX PRO 6000, alone, document reading on');
    assert.equal(V.poolGib({ ...pro, freeGib: 49.5 }).gib, 8, 'with ComfyUI holding ~45 GB');
    assert.equal(V.poolGib({ ...pro, ocrReserveGib: 0 }).gib, 61, 'document reading off: +9');
    assert.equal(V.poolGib({ totalGib: 119.2, unified: true, memAvailableGib: 110, weightsGib: 20.37, ocrReserveGib: 9, marginPct: 8, minFreeGb: 8 }).gib, 59, 'DGX Spark');
    const capped = V.poolGib({ ...pro, cap: 7 });
    assert.deepEqual([capped.gib, capped.why.capped, capped.ok], [7, true, true], 'a small model gets what its seats can use');
    const short = V.poolGib({ ...pro, freeGib: 36, personGib: 0.75 });
    assert.equal(short.ok, false);
    assert.equal(short.reason, 'The GPU has 36 GB free. After the model (20 GB), document reading (9 GB) and a safety margin, 0 GB are left for conversations: less than one person\'s conversation needs (0.8 GB). Close what else uses the GPU, or lower the context per person.');
    assert.match(V.poolGib({ totalGib: 119.2, unified: true, memAvailableGib: 40, weightsGib: 20.37, ocrReserveGib: 9, marginPct: 8, minFreeGb: 8 }).reason, /^This computer has 40 GB of memory available\. After the model .*, the 8 GB kept so the computer cannot run out and a safety margin, 0 GB are left/);
    const lib = defaultConfig().vllm.library;
    const q36 = V.facts(lib[0]);
    assert.deepEqual(q36, { kvBytesPerToken: 10240, stateBytes: 128778240, nativeCtx: 262144 });
    assert.equal(V.peopleFit(50, 65536, q36), 67, 'vLLM itself said 65.82x for this pool');
    assert.equal(V.peopleFit(8, 65536, q36), 10);
    assert.equal(V.facts({ ...lib[0], args: [] }).kvBytesPerToken, 20480, 'no fp8 flag: 16-bit context memory');
    assert.equal(V.facts(lib[2]).kvBytesPerToken, 32768, 'fp8_e4m3 is fp8');
    assert.equal(V.peopleFit(50, 65536, V.facts({ id: 'x', catalog: null })), null, 'unknown model: unknown');
    assert.deepEqual([1, 8, 16, 17, 48, 64, 96, 200, 512].map(V.maxNumSeqsAuto), [32, 32, 32, 64, 128, 128, 256, 512, 512]);
    const seats = (e, gpu, ctx, fit = null) => V.seatsAuto(e, gpu, ctx, fit);
    assert.deepEqual([32768, 65536, 131072].map((x) => seats(lib[0], PRO, x).seats), [96, 48, 32], 'PRO 6000 + Qwen3.6');
    assert.deepEqual([32768, 65536, 131072].map((x) => seats(lib[0], 'NVIDIA GB10', x).seats), [8, 8, 4], 'DGX Spark + Qwen3.6');
    assert.deepEqual(seats(lib[1], PRO, 65536), { seats: 16, source: 'measured', label: '16' }, 'Nemotron at 64k');
    assert.deepEqual(seats(lib[1], 'NVIDIA GB10', 65536), { seats: 4, source: 'measured', label: '< 8' }, '"< 8": half of it');
    assert.deepEqual(seats(lib[2], PRO, 65536), { seats: 24, source: 'measured', label: '≥ 24' }, '"≥ 24": 24');
    assert.equal(seats(lib[0], PRO, 8192).seats, 96, 'a smaller context counts on the nearest measured one above');
    assert.deepEqual(seats(lib[0], PRO, 65536, 10), { seats: 10, source: 'memory', label: '48' }, 'never more than the pool holds (8 GB → 10)');
    assert.deepEqual(seats(lib[0], PRO, 262144, 30), { seats: 16, source: 'memory', label: null }, 'past the measured contexts');
    assert.deepEqual(seats(lib[0], 'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition', 65536), { seats: 4, source: 'default', label: null }, 'a Max-Q was not measured');
    assert.equal(seats(lib[0], 'NVIDIA GeForce RTX 5090', 65536, 9).seats, 9);
    assert.deepEqual(V.measuredFor(lib[0], PRO).at[65536], { every: '48', steady: '≥ 64' });
    assert.equal(V.measuredFor(lib[0], 'NVIDIA RTX A6000'), null);
});

test('vLLM flags compare as a map: order, --uds, repeats, JSON (§11.1-9)', () => {
    const a = V.flagMap(['/model', '--a', '1', '--b', '--uds', '/x.sock', '--c=z', '--override-generation-config', '{"max_new_tokens": 32768}']);
    assert.deepEqual(a, { '--a': '1', '--b': true, '--c': 'z', '--override-generation-config': { max_new_tokens: 32768 } });
    assert.deepEqual(V.flagMap(['--c', 'z', '--override-generation-config', '{"max_new_tokens":32768}', '--b', '--a', '1']), a, 'whatever the order and the JSON spacing');
    assert.equal(V.flagMap(['--kv', '1', '--kv', '2'])['--kv'], '2', 'the last value wins, as in vLLM');
    assert.equal(V.flagMap(['--n', '-1'])['--n'], '-1');
});

test('vLLM decisions: at boot, when it stops answering, and an orphan left by a crash (§11.1-10)', () => {
    const run = (ready) => ({ pgid: 9, ready });
    assert.deepEqual(V.bootDecision({ supported: { ok: false, why: 'mac' } }), { action: 'unavailable', reason: V.UNSUPPORTED });
    assert.deepEqual(V.bootDecision({ problems: ['vLLM is not installed on this computer yet: press Install vLLM.', 'x'] }), { action: 'unavailable', reason: 'vLLM is not installed on this computer yet: press Install vLLM.' });
    assert.equal(V.bootDecision({ running: run(true), adopt: { ok: true } }).action, 'adopt');
    assert.equal(V.bootDecision({ running: run(false), adopt: { ok: true } }).action, 'wait', 'a farm crash in the middle of a start');
    assert.equal(V.bootDecision({ running: run(true), adopt: { ok: false } }).action, 'restart');
    assert.equal(V.bootDecision({}).action, 'start');
    // A server that runs with these settings is kept whatever the check says (review 2026-10-07: one nvidia-smi
    // miss sent the farm to Ollama beside a live 75 GB vLLM); one that runs otherwise is unavailable, as before.
    const miss = ['Ubuntu cannot see the GPU. Install the latest NVIDIA driver for Windows (it also serves WSL), restart the computer, then press Check again.'];
    assert.equal(V.bootDecision({ problems: miss, running: run(true), adopt: { ok: true } }).action, 'adopt');
    assert.equal(V.bootDecision({ problems: miss, running: run(false), adopt: { ok: true } }).action, 'wait');
    assert.deepEqual(V.bootDecision({ problems: miss, running: run(true), adopt: { ok: false } }), { action: 'unavailable', reason: miss[0] });
    // WSL gave no answer at all (a slow log on, review 2026-10-07): the start is queued and checks again once the farm
    // is up, instead of Ollama for the whole run; an answer that says what is missing still serves with Ollama.
    const late = ['WSL did not answer. Restart the computer, then press Check again.'];
    assert.deepEqual(V.bootDecision({ problems: late, noAnswer: true }), { action: 'start', reason: null });
    assert.equal(V.bootDecision({ supported: { ok: false }, noAnswer: true }).action, 'unavailable');
    assert.equal(V.unanswered({ st: null, stError: 'timeout' }), true);
    assert.equal(V.unanswered({ st: null, wsl: { error: 'timeout' } }), true);
    assert.equal(V.unanswered({ st: null, wsl: { error: 'no-wsl' } }), false, 'an answer: WSL is missing');
    assert.equal(V.unanswered({ st: null, wsl: { list: [{ name: 'Ubuntu', version: 1 }] } }), false, 'an answer: WSL 1');
    assert.equal(V.unanswered({ st: { running: null } }), false);
    // `wsl -l -v` (runCmd's result): "no distribution" only when WSL says so (English and French as wsl.exe 2.x prints
    // them, or its error code); any other failure without a list is no answer, so a WSL service not ready yet at a
    // slow log on queues the start instead of Ollama serving for the whole run (verifier, 2026-10-08).
    const wsl = (out, code = 1, err = '') => V.wslAnswer({ code, out, err, timedOut: false, error: null });
    const noDistroEn = "Windows Subsystem for Linux has no installed distributions.\nYou can resolve this by installing a distribution with the instructions below:\n\nUse 'wsl.exe --list --online' to list available distributions\nand 'wsl.exe --install <Distro>' to install.\n";
    assert.deepEqual(wsl(noDistroEn), { error: 'no-distro' });
    assert.deepEqual(wsl('Sous-système Windows pour Linux n’a aucune distribution installée.\n'), { error: 'no-distro' });
    assert.deepEqual(wsl('Für das Windows-Subsystem für Linux sind keine Distributionen installiert.\nFehlercode: Wsl/WSL_E_DEFAULT_DISTRO_NOT_FOUND\n'), { error: 'no-distro' }, 'any language: the error code');
    assert.deepEqual(wsl('Windows Subsystem for Linux is not installed.\n'), { error: 'no-wsl' });
    // French Windows' own sentence (C:\Windows\System32\fr-FR\KernelBase.dll.mui), with its typographic apostrophes:
    // read as "no answer" it sent a PC without WSL to "restart the computer", which never helps.
    assert.deepEqual(wsl('Le Sous-système Windows pour Linux n’est pas installé. Vous pouvez effectuer l’installation en exécutant « wsl.exe --install ».\n'), { error: 'no-wsl' });
    for (const out of ['Catastrophic failure\nError code: Wsl/Service/E_UNEXPECTED\n', 'Le service ne peut pas être démarré.\n', '', 'Il n’existe aucune distribution avec le nom fourni.\n']) {
        const a = wsl(out);
        assert.deepEqual(a, { error: 'timeout' }, JSON.stringify(out));
        assert.equal(V.unanswered({ st: null, wsl: a }), true, 'no answer: the start is queued');
    }
    assert.deepEqual(V.wslAnswer({ code: null, out: '', err: '', timedOut: true, error: 'timeout' }), { error: 'timeout' });
    assert.deepEqual(V.wslAnswer({ code: null, out: '', err: '', timedOut: false, error: 'ENOENT' }), { error: 'no-wsl' });
    assert.equal(wsl('  NAME      STATE           VERSION\n* Ubuntu    Running         2\n', 0)[0].name, 'Ubuntu');
    // The plan says the same rule (§5, boot step 0c-ter b).
    const plan = path.join(__dirname, '..', '..', 'docs', 'VLLM_MANAGED_PLAN.md');
    if (fs.existsSync(plan)) {   // a farm-only copy (the Farm app ships farm/ alone) has no docs
        const step = fs.readFileSync(plan, 'utf8').split('Boot, step 0c-ter')[1].split('\n- c)')[0];
        assert.ok(!/on timeout or error → unavailable/.test(step) && /the start is queued/.test(step) && /too small[^.]*is an answer/.test(step), step);
    }
    // A start that finds a vLLM running from its root keeps it when it runs with these settings, is ready and
    // answers; a hung one or one whose port is dead is started again (review 2026-10-07).
    assert.equal(V.keepRunning({ running: run(true), adopt: { ok: true }, answers: true }), true);
    assert.equal(V.keepRunning({ running: run(false), adopt: { ok: true }, answers: true }), false, 'not ready: hung');
    assert.equal(V.keepRunning({ running: run(true), adopt: { ok: true }, answers: false }), false, 'its port is dead');
    assert.equal(V.keepRunning({ running: run(true), adopt: { ok: false }, answers: true }), false, 'other settings');
    assert.equal(V.keepRunning({}), false);
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(upSrc.includes("const d = vllmMod.bootDecision({ supported: vllmSup, problems: pr.problems, running, adopt, noAnswer });"), 'the boot asks it');
    assert.ok(upSrc.includes('const noAnswer = vllmMod.unanswered(vllmProbe) && !pr.gpuTooSmall;'), 'a GPU too small (seen by Windows before WSL) is an answer: Ollama at once, no queued start');
    assert.ok(upSrc.includes("if (vllmMod.keepRunning({ running: st.running, adopt: a, answers: await vllmAlive(3000) })) {"), 'and a start');
    const now = 1e9;
    assert.equal(V.downDecision({ guard: true, lastRestartAt: now - 1000, now }), 'guard', 'the memory guard\'s stop is never undone');
    assert.equal(V.downDecision({ running: true, ready: true, portAnswers: true, now }), 'none', 'slow, but it answers');
    assert.equal(V.downDecision({ running: true, ready: true, portAnswers: false, now }), 'restart', 'the socket answers, the port does not: the relay died');
    assert.equal(V.downDecision({ running: true, ready: false, portAnswers: false, now }), 'restart', 'hung');
    assert.equal(V.downDecision({ now }), 'restart');
    assert.equal(V.downDecision({ lastRestartAt: now - 4 * 60e3, now }), 'fallback', 'a second time within 5 minutes');
    assert.equal(V.downDecision({ lastRestartAt: now - 6 * 60e3, now }), 'restart');
    const st = (managed) => ({ running: { pgid: 9 }, managed });
    assert.deepEqual(['ollama', 'llamacpp', 'external', 'vllm'].map((e) => V.isOrphan(e, st(true))), [true, true, true, false], 'the farm\'s own vLLM beside another engine: stop it');
    assert.equal(V.isOrphan('ollama', st(false)), false, 'no marker: someone else\'s, left alone');
    assert.equal(V.isOrphan('ollama', { running: null, managed: true }), false);
});

test('vLLM start phases, read from its real log (vLLM 0.30, 2026-10-07 17:45-17:47) with its carriage-return bars (§11.1-11)', () => {
    const log = fs.readFileSync(path.join(FIX, 'vllm-start.log'), 'utf8');
    assert.ok(/Capturing CUDA graphs[^\n]*\r[^\n]*Capturing CUDA graphs/.test(log), 'the fixture keeps vLLM\'s \\r updates inside one line');
    const end = V.startPhase(log);
    assert.deepEqual([end.key, end.poolTokens, end.peopleFit, end.weightsGib], ['ready', 4313303, 65, 20.37]);
    // As the farm reads it: new bytes at a time, the last result carried along.
    let s = null; const keys = []; const pct = new Set(); const texts = new Set();
    for (const chunk of log.split('\n')) {
        s = V.startPhase(`${chunk}\n`, s);
        if (keys[keys.length - 1] !== s.key) keys.push(s.key);
        if (s.key === 'weights') { pct.add(s.percent); texts.add(s.text); }
    }
    assert.deepEqual(keys, ['starting', 'reading', 'weights', 'kernels', 'graphs', 'almost', 'ready']);
    assert.ok([33, 67, 100].every((p) => pct.has(p)), [...pct].join());
    assert.ok(texts.has('loading the model weights (2 of 3)'));
    s = V.startPhase('[serve] 2026-10-07T18:00:00+02:00 vLLM exited (status 1); the relay and the watchdog are stopped.\n', s);
    assert.deepEqual([s.key, s.status, s.text], ['exited', 1, 'stopped']);
    s = V.startPhase('[serve] 2026-10-07T18:01:00+02:00 host=x pgid=77 port=8100 model=/m daemon=1 min_free_gb=off\n', s);
    assert.deepEqual([s.key, s.poolTokens], ['starting', null], 'a new start begins again');
    // serve.sh moves a log over 50 MB aside at a start: a file smaller than the saved offset is read from 0.
    assert.equal(V.logOffset(100, 5000), 0);
    assert.equal(V.logOffset(6000, 5000), 5000);
});

test('vLLM start: a server of its own is ready once serve.sh logged it so, never because something answers on its port (review 2026-10-07)', async () => {
    const { EventEmitter } = require('events');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lol-wait-'));
    try {
        fs.mkdirSync(path.join(dir, 'logs'));
        const log = path.join(dir, 'logs', 'vllm.log');
        // readLog reads <root>/logs/vllm.log of a Linux target; on Windows a root written /Users/… is on this drive.
        const t = { platform: 'linux', root: process.platform === 'win32' ? dir.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/') : dir, port: 1 };
        fs.writeFileSync(log, '[serve] 2026-10-07T23:00:00+02:00 host=x pgid=77 port=8100 model=/m daemon=1 min_free_gb=off\n');
        // Another program answers on the port from the first poll; this start's own server never says it is ready.
        let asked = 0;
        const r = await V.waitReady(t, { child: new EventEmitter(), alive: async () => true, isReady: async () => { asked++; return false; }, pollMs: 20, stallMs: 300 });
        assert.deepEqual([r.ok, r.code, r.phase.key, asked], [false, 'stall', 'starting', 1], 'never ready on the port alone; status.sh asked, at most every 30 s');
        // status.sh says this root's own server is ready: it is.
        assert.equal((await V.waitReady(t, { child: new EventEmitter(), alive: async () => true, isReady: async () => true, pollMs: 20, stallMs: 300 })).ok, true);
        // serve.sh logged it ready: it is, with no question to status.sh.
        fs.appendFileSync(log, '[serve] 2026-10-07T23:01:40+02:00 ready: http://127.0.0.1:8100/v1\n');
        const r2 = await V.waitReady(t, { child: new EventEmitter(), alive: async () => true, isReady: async () => { throw new Error('not asked'); }, pollMs: 20, stallMs: 300 });
        assert.deepEqual([r2.ok, r2.phase.key], [true, 'ready']);
        // Ready in the log but the port does not answer (the relay died): not ready.
        assert.equal((await V.waitReady(t, { child: new EventEmitter(), alive: async () => false, pollMs: 20, stallMs: 200 })).ok, false);
        // A start found running at boot (no child, its settings read by status.sh after): the port answering is enough.
        fs.writeFileSync(log, '');
        assert.equal((await V.waitReady(t, { alive: async () => true, pollMs: 20, stallMs: 300 })).ok, true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('vLLM start failures, in plain words (§11.1-12, §7.5)', () => {
    const ctx = { root: '/home/me/lol-vllm', port: 8100, label: 'Qwen3.6 35B-A3B · NVFP4', otherGpuGb: 45.2 };
    const say = (code, lines) => V.explainFailure(code, lines, ctx);
    assert.equal(say(3, ['[guard] 2026-10-07T18:00:00+02:00 5 GB of memory available, under LOL_VLLM_MIN_FREE_GB=8: stopping vLLM']),
        'vLLM was stopped because this computer was running out of memory (5 GB left; it stops below 8 GB, before the GPU gets stuck at a slow speed). Close what is using the memory, then press Start vLLM.');
    assert.match(say(3, []), /^vLLM was stopped because this computer was running out of memory\. Close/);
    assert.equal(say(1, ['(EngineCore pid=7) torch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB']),
        'vLLM ran out of GPU memory while starting. Lower GPU memory for conversations or the context, or close other programs using the GPU (they use 45 GB now).');
    assert.match(say(1, ['ValueError: No available memory for the cache blocks.']), /ran out of GPU memory/);
    assert.equal(say(1, ['[serve] x A server from /home/me/lol-vllm is already running (process group 401): stop it first with stop.sh.']),
        'A vLLM from /home/me/lol-vllm is already running but does not answer. Press Stop vLLM, then Start vLLM.');
    assert.equal(say(1, ['[serve] x The relay could not listen on 127.0.0.1:8100 (is the port in use?).']),
        'Another program uses port 8100, maybe a vLLM started outside the farm. Stop it, then press Start vLLM.');
    assert.equal(say(1, ['[serve] x No vLLM in /home/me/lol-vllm/.venv: run install.sh first, or set LOL_VLLM_ROOT.']), 'vLLM is not installed in /home/me/lol-vllm. Press Install vLLM.');
    assert.equal(say(1, ['ValueError: Model architectures [\'Foo\'] failed to be inspected.']), 'This vLLM version cannot load Qwen3.6 35B-A3B · NVFP4. Pick another model.');
    assert.equal(say('stall', []), 'vLLM stopped making progress for 10 minutes. Show the log for details.');
    assert.equal(say('cap', []), 'vLLM was still not ready after 30 minutes. Show the log for details.');
    assert.equal(say(1, ['(APIServer pid=5) INFO a', '(EngineCore pid=6) ERROR 10-07 17:46:07 [core.py:12] EngineCore failed to start.', 'Traceback (most recent call last):', '  File "x.py"', 'RuntimeError: CUDA error: no kernel image is available']),
        'vLLM stopped while starting. Its last error: RuntimeError: CUDA error: no kernel image is available');
    assert.equal(say(1, ['(EngineCore pid=6) ERROR 10-07 17:46:07 [core.py:12] EngineCore failed to start.']), 'vLLM stopped while starting. Its last error: EngineCore failed to start.');
    assert.equal(say(1, ['INFO nothing useful']), 'vLLM stopped while starting (status 1). Show the log for details.');
});

test('vLLM on this computer: the checklist, every blocking sentence, and the disk that counts (§11.1-13, §7.2)', () => {
    const c = defaultConfig();
    const status = (lines) => V.parseStatus(['home=/home/me', 'arch=x86_64', 'curl=/usr/bin/curl', 'cc=/usr/bin/gcc', `gpu=${PRO}, 97887, 95000, 12.0`,
        'mem_total_kb=98875528', 'mem_available_kb=91993964', 'disk_free_kb=600000000', 'install=/home/me/lol-vllm 0.30.0',
        'model=Qwen3.6-35B-A3B-NVFP4 22880000 vision=1 native=262144 partial=0', ...lines].join('\n'));
    const ubuntu = { list: [{ name: 'Ubuntu', state: 'Running', version: 2, isDefault: true }] };
    const win = (over = {}) => ({ platform: 'win32', arch: 'x64', wsl: ubuntu, st: status([]), hostDiskFreeGb: 500, hostDrive: 'C', ...over });
    const lin = (over = {}) => ({ platform: 'linux', arch: 'x64', st: status([]), ...over });
    const P = (probe, cfg = c) => V.problemsFrom(probe, cfg);
    let r = P(win());
    assert.deepEqual(r.problems, []);
    assert.deepEqual(r.oks, ['WSL is installed, with Ubuntu on WSL 2.', `Ubuntu sees the GPU: ${PRO} (96 GB).`, 'Found an existing vLLM in /home/me/lol-vllm: the farm will use it.', '500 GB free for vLLM and its models.']);
    assert.deepEqual(P({ platform: 'darwin', arch: 'arm64' }).problems, [V.UNSUPPORTED]);
    // A script missing from farm/vllm (the Farm app's update stopped half-way, PRO 6000, 2026-10-08): said as such,
    // never "WSL did not answer … restart the computer", and not counted as no answer (which would queue the start).
    const missingProbe = win({ st: null, missing: true, stError: 'A file of the farm is missing (vllm/status.sh): its last update did not finish. Restart the farm to complete it (in the Farm app: Quit, then open it again).' });
    assert.deepEqual(P(missingProbe).problems, [missingProbe.stError]);
    assert.equal(V.unanswered(missingProbe), false);
    assert.match(P(win({ wsl: { error: 'no-wsl' } })).problems[0], /^WSL is not installed\. .*run {2}wsl --install -d Ubuntu , and restart the computer/);
    assert.equal(P(win({ wsl: { error: 'timeout' } })).problems[0], 'WSL did not answer. Restart the computer, then press Check again.');
    assert.equal(P(win({ st: null })).problems[0], 'WSL did not answer. Restart the computer, then press Check again.', 'status.sh timed out');
    assert.match(P(win({ wsl: { list: [] } })).problems[0], /^WSL has no Ubuntu yet\./);
    assert.equal(P(win({ wsl: { list: [{ name: 'Ubuntu', version: 1, isDefault: true }] } })).problems[0], 'Ubuntu runs on WSL 1, which cannot use the GPU. In PowerShell, run  wsl --set-version Ubuntu 2  (a few minutes), then press Check again.');
    r = P(win({ wsl: { list: [{ name: 'docker-desktop', version: 2, isDefault: true }, { name: 'Ubuntu-24.04', version: 2, isDefault: false }] } }));
    assert.equal(r.oks[0], 'WSL is installed, with Ubuntu-24.04 on WSL 2.', 'Docker Desktop\'s default distribution is skipped');
    const noGpu = V.parseStatus('home=/home/me\narch=x86_64\ncurl=/usr/bin/curl\n');
    assert.equal(P(win({ st: noGpu })).problems[0], 'Ubuntu cannot see the GPU. Install the latest NVIDIA driver for Windows (it also serves WSL), restart the computer, then press Check again.');
    const NO_NVIDIA = 'No NVIDIA GPU was found on this computer (nvidia-smi does not answer). vLLM needs one: if this computer has one, install its latest NVIDIA driver, restart the computer, then press Check again; if not, llama.cpp or Ollama is the engine for it.';
    assert.equal(P(lin({ st: noGpu })).problems[0], NO_NVIDIA);
    // On Windows, what Windows itself sees comes first (review 2026-10-07: a PC with no NVIDIA GPU was told to install
    // WSL, then the NVIDIA driver): no NVIDIA GPU, where WSL cannot contradict it...
    const amd = { name: null, gb: null };
    assert.deepEqual(P(win({ hostGpu: amd, wsl: { error: 'no-wsl' }, st: null })).problems, [NO_NVIDIA]);
    assert.deepEqual(P(win({ hostGpu: amd, st: noGpu })).problems, [NO_NVIDIA], 'WSL sees none either');
    // ...but not where it can: a slow nvidia-smi at log on reads the same, and WSL saw the GPU, or did not answer.
    assert.deepEqual(P(win({ hostGpu: amd })).problems, []);
    assert.equal(P(win({ hostGpu: amd, wsl: { error: 'timeout' }, st: null })).problems[0], 'WSL did not answer. Restart the computer, then press Check again.');
    assert.equal(P(lin({ st: { ...status([]), arch: 'armv7l' } })).problems[0], 'vLLM needs a 64-bit Intel, AMD or ARM processor.');
    assert.ok(P(lin({ st: { ...status([]), curl: null } })).problems.includes('curl is missing. In a terminal, run  sudo apt install curl , then press Check again.'));
    assert.ok(P(win({ st: { ...status([]), curl: null } })).problems.includes('curl is missing. Open Ubuntu from the Start menu, run  sudo apt install curl , then press Check again.'), 'Windows: where to type it');
    // vLLM compiles its GPU launcher with the system's C compiler at a start: a fresh Ubuntu in WSL has none (review
    // 2026-10-07: Triton refuses with "Failed to find C compiler", a Python error nobody can act on).
    assert.equal(V.parseStatus('cc=/usr/bin/gcc\n').cc, '/usr/bin/gcc');
    assert.equal(V.parseStatus('cc=\n').cc, null);
    assert.ok(P(win({ st: { ...status([]), cc: null } })).problems.includes('vLLM needs a C compiler to prepare the GPU, and this Ubuntu has none. Open Ubuntu from the Start menu, run  sudo apt install build-essential , then press Check again.'));
    assert.ok(P(lin({ st: { ...status([]), cc: null } })).problems.includes('vLLM needs a C compiler to prepare the GPU, and this computer has none. In a terminal, run  sudo apt install build-essential , then press Check again.'));
    assert.equal(P(lin()).gpuTooSmall, false);
    // The studio's smaller cards (owner 2026-10-07: Windows with RTX cards first): no model of the list fits an RTX
    // 4070 (12 GB) or 4080 (16 GB), with or without document reading's share; the panel says so and offers nothing.
    const card = (name, mib, cap) => V.parseStatus(['home=/home/me', 'arch=x86_64', 'curl=/usr/bin/curl', 'cc=/usr/bin/gcc', `gpu=${name}, ${mib}, ${mib - 1000}, ${cap}`].join('\n'));
    const small = card('NVIDIA GeForce RTX 4070', 12282, 8.9);
    r = P(lin({ st: small }));
    assert.deepEqual(r.problems.filter((x) => /too little/.test(x)), ['This GPU has 12 GB: too little for any model in the vLLM list (the smallest needs about 35 GB, with 9 GB kept for document reading). llama.cpp or Ollama is the engine for this card.']);
    assert.equal(r.gpuTooSmall, true, 'nothing to install for: no Install button');
    assert.deepEqual(r.warnings, [], 'too small says it all: no "older card" warning beside it');
    const noOcr = { ...c, ocr: { ...c.ocr, enabled: false } };
    assert.ok(P(lin({ st: card('NVIDIA GeForce RTX 4080', 16376, 8.9) }), noOcr).problems.includes('This GPU has 16 GB: too little for any model in the vLLM list (the smallest needs about 25 GB). llama.cpp or Ollama is the engine for this card.'));
    // A 24 GB card fits no model either: the old rule (weights + 6 GB) let it through, and its start failed.
    assert.equal(P(lin({ st: card('NVIDIA GeForce RTX 4090', 24564, 8.9) }), noOcr).gpuTooSmall, true);
    // A 32 GB card: not beside document reading's share, which is said; without it, it fits.
    r = P(lin({ st: card('NVIDIA GeForce RTX 5090', 32607, 12.0) }));
    assert.ok(r.problems.includes('This GPU has 32 GB: too little for any model in the vLLM list (the smallest needs about 35 GB, with 9 GB kept for document reading). llama.cpp or Ollama is the engine for this card. Turning document reading off would make room for one.'), r.problems.join('|'));
    assert.equal(P(lin({ st: card('NVIDIA GeForce RTX 5090', 32607, 12.0) }), noOcr).gpuTooSmall, false);
    assert.deepEqual(P(lin({ st: card('NVIDIA A100-SXM4-80GB', 81920, 8.0) })).warnings, ['This GPU is older than the cards these models were measured on (RTX PRO 6000, DGX Spark): they may not load. If a start fails, llama.cpp is the engine for this card.']);
    // On Windows the size Windows sees is said before anything about WSL, which would be installed for nothing.
    r = P(win({ hostGpu: { name: 'NVIDIA GeForce RTX 4070', gb: 12 }, wsl: { error: 'no-wsl' }, st: null }));
    assert.deepEqual(r.problems, ['This GPU has 12 GB: too little for any model in the vLLM list (the smallest needs about 35 GB, with 9 GB kept for document reading). llama.cpp or Ollama is the engine for this card.']);
    assert.equal(r.gpuTooSmall, true);
    assert.equal(P(win({ hostGpu: { name: PRO, gb: 96 } })).problems.length, 0, 'a PRO 6000 fits');
    assert.deepEqual(V.gpuFit(c, 12), { fits: false, needGib: (17.82 + 4 + 1 + 9) / 0.92, ocrGib: 9, fitsWithoutOcr: false });
    assert.equal(V.gpuFit(c, 119, { unified: true }).fits, true, 'a DGX Spark, its memory guard included');
    assert.equal(V.gpuFit(c, 0), null);
    // A model added by its name has no size until it is downloaded: left out of the smallest, not counted as 0 GB,
    // which made a 16 GB card "fit" (verifier, 2026-10-08). With no size known at all, nothing is said.
    const byRepo = V.newLibraryEntry({ repo: 'org/Tiny-Model' }, c.vllm.library).entry;
    assert.equal(byRepo.sizeGb, null);
    const withRepo = { ...c, vllm: { ...c.vllm, library: [...c.vllm.library, byRepo] } };
    assert.deepEqual(V.gpuFit(withRepo, 16), V.gpuFit(c, 16));
    assert.equal(V.gpuFit(withRepo, 16).fits, false);
    assert.equal(P(win({ hostGpu: { name: 'NVIDIA GeForce RTX 4080', gb: 16 } }), withRepo).gpuTooSmall, true, 'still too small for the 4080');
    assert.equal(V.gpuFit({ ...c, vllm: { ...c.vllm, library: [byRepo] } }, 16), null, 'unknown, not "fits"');
    // Windows' nvidia-smi can be slow at log on: a GPU it missed at boot is read again at each check, and the
    // checklist (and the vLLM button) correct themselves.
    assert.deepEqual(V.hostGpuOf({ gpu: 'Unknown GPU', vramGb: 0 }), { name: null, gb: null });
    const host = V.hostGpuOf({ gpu: 'Unknown GPU', vramGb: 0 });
    const late4080 = win({ hostGpu: host, wsl: { error: 'no-wsl' }, st: null });
    assert.match(P(late4080).problems[0], /^No NVIDIA GPU was found/);
    Object.assign(host, V.hostGpuOf({ gpu: 'NVIDIA GeForce RTX 4080', vramGb: 16 }));
    assert.match(P(late4080).problems[0], /^This GPU has 16 GB: too little/, 'the same check, once nvidia-smi answered');
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    const check = upSrc.split('async function checkVllm() {')[1].split('\n    }')[0];
    assert.ok(check.includes('if (!hostGpu.name) Object.assign(hostGpu, vllmMod.hostGpuOf(await detectHardware()));'), 'checkVllm (Check again, a start) reads it again');
    assert.ok(upSrc.includes('const hostGpu = vllmMod.hostGpuOf(hw);'));
    const spark = V.parseStatus(['home=/home/me', 'arch=aarch64', 'curl=/usr/bin/curl', 'gpu=NVIDIA GB10, [N/A], [N/A], 12.1', 'mem_total_kb=124991588', 'mem_available_kb=115343360', 'disk_free_kb=3000000000', 'install=/home/me/lol-vllm 0.29.0'].join('\n'));
    r = P(lin({ st: spark }), { ...c, vllm: { ...c.vllm, root: '~/lol-vllm' } });
    assert.ok(r.oks.includes('GPU: NVIDIA GB10 (119 GB shared with the system).') && r.oks.includes('vLLM 0.29.0 is installed (in /home/me/lol-vllm).'), r.oks.join('|'));
    assert.ok(r.warnings.includes('vLLM 0.29.0 is installed; this farm was tested with 0.30.0.'));
    assert.ok(r.problems.includes('Qwen3.6 35B-A3B · NVFP4 is not downloaded yet: press Download next to it.'));
    // Before vLLM is installed the list has no Download button: Install vLLM brings the model (PRO 6000, 2026-10-08).
    const bare = V.parseStatus(['home=/home/me', 'arch=x86_64', 'curl=/usr/bin/curl', 'cc=/usr/bin/cc', `gpu=${PRO}, 97887, 90000, 12.0`, 'mem_total_kb=1', 'mem_available_kb=1', 'disk_free_kb=3000000000'].join('\n'));
    r = P(lin({ st: bare }));
    assert.ok(r.problems.includes('vLLM is not installed on this computer yet: press Install vLLM.'), r.problems.join('|'));
    assert.ok(r.problems.includes('Qwen3.6 35B-A3B · NVFP4 is not downloaded yet: Install vLLM downloads it too.'), r.problems.join('|'));
    assert.ok(!r.problems.some((p) => /press Download next to it/.test(p)));
    const partly = status(['installing=88']);
    partly.models = V.parseStatus('model=Qwen3.6-35B-A3B-NVFP4 2000000 vision=0 native= partial=1').models;
    r = P(lin({ st: partly }));
    assert.ok(r.problems.includes('Qwen3.6 35B-A3B · NVFP4 is only partly downloaded: press Download to finish it.') && r.problems.includes('A download started earlier is still running. Wait for it, or stop it here.'), r.problems.join('|'));
    r = P(lin({ st: { ...status([]), installs: [] } }));
    assert.ok(r.problems.includes('vLLM is not installed on this computer yet: press Install vLLM.'));
    // Disk: on Windows the smaller of WSL's own virtual disk and the Windows drive that holds it.
    const fresh = { ...status([]), installs: [], models: [] };
    r = P(win({ st: fresh, hostDiskFreeGb: 20 }));
    assert.ok(r.problems.includes('Not enough free disk: vLLM and Qwen3.6 35B-A3B · NVFP4 need about 33 GB, and 20 GB are free. Ubuntu\'s disk lives on drive C:. Free some space, then press Check again.'), r.problems.join('|'));
    assert.ok(!P(win({ st: fresh, hostDiskFreeGb: 40 })).problems.some((x) => x.startsWith('Not enough free disk')));
    assert.ok(P(lin({ st: { ...fresh, diskFreeGb: 30 } })).problems.some((x) => x.startsWith('Not enough free disk: vLLM and')));
    // A download or an install checks the disk before it fills it, and leaves 10 GB free beside it (review
    // 2026-10-07: WSL's disk grows on drive C: and never gives the space back).
    const nem = c.vllm.library.find((e) => e.id === 'nemotron-3.5-lightning');
    const dl = (over) => V.diskCheck(win(over), nem, { keepGb: 10, button: 'Download', distro: 'Ubuntu' });
    assert.deepEqual(dl({ hostDiskFreeGb: 28 }), { need: 21.6, free: 28, problem: 'Not enough free disk: Nemotron 3.5 Lightning 30B-A3B · NVFP4 needs about 22 GB, and 28 GB are free (the farm leaves 10 GB free beside it). Ubuntu\'s disk lives on drive C:. Free some space, then press Download again.' });
    assert.equal(dl({ hostDiskFreeGb: 32 }).problem, null);
    const partNem = { ...status([]), models: [{ folder: 'NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4', gb: 15, partial: true }] };
    assert.equal(dl({ st: partNem, hostDiskFreeGb: 20 }).problem, null, 'what is already downloaded counts: 6.6 GB left to fetch');
    assert.equal(dl({ st: { ...partNem, models: [{ ...partNem.models[0], gb: 21.6, partial: false }] }, hostDiskFreeGb: 1 }).problem, null, 'downloaded: nothing to fetch');
    assert.match(V.diskCheck(lin({ st: { ...fresh, diskFreeGb: 40 } }), c.vllm.library[0], { venv: true, keepGb: 10, button: 'Install vLLM' }).problem,
        /^Not enough free disk: vLLM and Qwen3\.6 35B-A3B · NVFP4 need about 33 GB, and 40 GB are free \(the farm leaves 10 GB free beside it\)\. Free some space, then press Install vLLM again\.$/);
    assert.match(V.diskCheck(lin({ st: { ...fresh, diskFreeGb: 15 } }), null, { venv: true, keepGb: 10, button: 'Update vLLM' }).problem, /^Not enough free disk: vLLM needs about 10 GB/);
    // Where vLLM lives.
    assert.equal(V.resolveRoot(c, status([])), '/home/me/lol-vllm');
    assert.equal(V.resolveRoot(c, { ...status([]), installs: [{ root: '/home/me/lol-spike' }] }), '/home/me/lol-spike', 'the spike\'s install is reused');
    assert.equal(V.resolveRoot({ vllm: { root: '~/x' } }, status([])), '/home/me/x');
    assert.equal(V.resolveRoot(c, null), '~/lol-vllm');
});

test('vLLM: wsl.exe\'s UTF-16, its list, and status.sh\'s report as recorded (§11.1-14)', () => {
    const bytes = fs.readFileSync(path.join(FIX, 'wsl-l-v.bin'));
    assert.ok(bytes[1] === 0 && bytes[0] !== 0xff, 'recorded as wsl.exe writes it: UTF-16LE, no BOM');
    assert.match(V.decodeWsl(bytes), /NAME\s+STATE\s+VERSION/);
    assert.equal(V.decodeWsl(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Ubuntu', 'utf16le')])), 'Ubuntu');
    assert.equal(V.decodeWsl(Buffer.from('Ubuntu ✓', 'utf8')), 'Ubuntu ✓');
    const list = V.parseWslList(bytes);
    assert.deepEqual(list, [{ name: 'Ubuntu', state: 'Running', version: 2, isDefault: true }]);
    assert.equal(V.defaultDistro(list), 'Ubuntu');
    const fr = V.parseWslList(Buffer.from('  NOM               ÉTAT                    VERSION\r\n* docker-desktop    En cours d\'exécution    2\r\n  Ubuntu            Arrêté                  1\r\n  Debian            Arrêté                  2\r\n', 'utf16le'));
    assert.deepEqual(fr.map((d) => [d.name, d.state, d.version]), [['docker-desktop', 'En cours d\'exécution', 2], ['Ubuntu', 'Arrêté', 1], ['Debian', 'Arrêté', 2]]);
    assert.equal(V.defaultDistro(fr), 'Debian', 'not Docker Desktop\'s, not a WSL 1 one');
    // status.sh's report, recorded by farm/vllm/test_scripts.sh with two fake servers beside the production one.
    const st = V.parseStatus(fs.readFileSync(path.join(FIX, 'vllm-status.txt'), 'utf8'));
    assert.deepEqual([st.home, st.cc], ['/home/ateliernum', '/usr/bin/gcc']);
    assert.deepEqual([st.gpu.name, Math.round(st.gpu.totalGib * 100) / 100, st.gpu.cap], [PRO, 95.59, 12]);
    assert.deepEqual(st.installs.map((i) => [i.root, i.version, i.link]), [['/tmp/lol-as-root', '0.30.0', false], ['/tmp/lol-as-root2', '0.30.0', false], ['/tmp/lol-as-link', '0.30.0', true]]);
    assert.deepEqual(st.models.map((m) => [m.folder, m.vision, m.native, m.partial]), [['M1', true, 262144, false], ['M2', false, 32768, true]]);
    assert.deepEqual({ ...st.running, argv: st.running.argv.slice(0, 3) }, { pgid: 6843, port: 46361, minFreeGb: null, managedArgs: null, argv: ['/tmp/lol-as-root/hf/Qwen3.6-35B-A3B-NVFP4', '--uds', '/tmp/lol-as-root/run/vllm.sock'], ready: true });
    assert.equal(st.running.argv[st.running.argv.length - 1], '{"max_new_tokens": 32768}');
    assert.deepEqual(st.found, [{ root: '/home/ateliernum/lol-spike', port: 8100, pgid: 401 }, { root: '/tmp/lol-as-root', port: 46361, pgid: 6843 }, { root: '/tmp/lol-as-root2', port: 47463, pgid: 6844 }]);
    assert.deepEqual([st.managed, st.installing, st.guardLine], [false, null, null]);
    const b64 = Buffer.from(['--served-model-name', 'm', '--x', 'a b'].join('\0')).toString('base64');
    const m = V.parseStatus(`running=5\nenv=LOL_VLLM_ARGS_B64=${b64}\nenv=LOL_VLLM_MIN_FREE_GB=8\nmanaged=1\nguard=[guard] t 5 GB\n`);
    assert.deepEqual([m.running.managedArgs, m.running.minFreeGb, m.running.port, m.running.ready, m.managed, m.guardLine], [['--served-model-name', 'm', '--x', 'a b'], 8, 8100, false, true, '[guard] t 5 GB']);
    assert.deepEqual(V.memOf(V.parseStatus('gpu=NVIDIA GB10, [N/A], [N/A], 12.1\nmem_total_kb=124991588\nmem_available_kb=115343360\n')).unified, true);
});

test('the download slot: outside serialize and busy(), a restart and a switch run during it, one download at a time, Stop cancels (§11.1-16, D7)', async () => {
    const { makeJobs } = require('../src/commands/up');
    const quiet = { ok() {}, err() {}, step() {}, warn() {} };
    let kicks = 0;
    const jobs = makeJobs({ kick: () => { kicks++; }, logger: quiet });
    let release; const held = new Promise((r) => { release = r; });
    let cancelledSeen = null; let cancelRan = 0;
    const d = jobs.runDownload('download', 'Downloading Qwen3.6', async (progress, ctl) => {
        progress('downloading Qwen3.6 — 1 of 23 GB', 4, { bytes: 1e9, total: 23e9 });
        await held;
        cancelledSeen = ctl.cancelled();
        return ctl.cancelled() ? { ok: false, error: 'Stopped. Press Download again to go on: the files it finished are kept.' } : { ok: true };
    }, { cancel: () => { cancelRan++; release(); } });
    assert.equal(d.ok, true);
    await new Promise((r) => setImmediate(r));
    assert.equal(jobs.busy(), false, 'a download is not the busy job: clients never see it, nothing is refused because of it');
    assert.equal(jobs.jobView(), null);
    assert.deepEqual([jobs.downloadView().label, jobs.downloadView().bytes, jobs.downloadView().total, jobs.downloadView().cancellable], ['Downloading Qwen3.6', 1e9, 23e9, true]);
    // serialize is free: the crash handler (onVllmDown) runs at once, not after 23 GB.
    let ranInSerialize = false;
    await jobs.serialize(async () => { ranInSerialize = true; });
    assert.ok(ranInSerialize, 'serialize does not wait for the download');
    // A restart job, then a switch, run to their end while the download still runs.
    const order = [];
    const r1 = jobs.runJob('engine', 'Restarting vLLM after it stopped unexpectedly', async () => { order.push('restart'); return { ok: true }; });
    assert.equal(r1.ok, true, 'the restart is not refused');
    assert.equal(jobs.busy(), true, 'the restart job is what clients see');
    assert.equal(jobs.runJob('backend', 'Switching to Ollama', async () => ({ ok: true })).ok, false, 'one admin job at a time still');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(order, ['restart']);
    assert.equal(jobs.jobView().done, true);
    const r2 = jobs.runJob('backend', 'Switching to Ollama', async () => { order.push('switch'); return { ok: true }; });
    assert.equal(r2.ok, true, 'a switch to another engine is not refused by the download');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(order, ['restart', 'switch']);
    assert.equal(jobs.downloadView().done, false, 'the download is still running');
    // One download at a time, and the panel says which.
    const second = jobs.runDownload('download', 'Downloading Nemotron', async () => ({ ok: true }));
    assert.deepEqual([second.ok, second.error], [false, 'A download is already running: Downloading Qwen3.6.']);
    // Stop.
    assert.equal(jobs.cancel('download').ok, true);
    assert.equal(jobs.downloadView().cancellable, false, 'Stop shows once');
    assert.equal(jobs.cancel('download').already, true);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(cancelRan, 1);
    assert.equal(cancelledSeen, true, 'the body reads the cancel');
    assert.deepEqual([jobs.downloadView().done, jobs.downloadView().ok, jobs.downloadView().cancelled], [true, false, true]);
    assert.equal(jobs.downloading(), null);
    assert.equal(jobs.runDownload('download', 'Downloading Nemotron', async () => ({ ok: true })).ok, true, 'the next one may start');
    assert.equal(jobs.cancel('job').ok, false, 'nothing runs in the job slot now');
    // A job whose body has returned does not refuse the one queued from inside serialize (onVllmDown → restart).
    let refused = null;
    jobs.runJob('engine', 'Checking', async () => {
        jobs.serialize(async () => { refused = jobs.runJob('engine', 'Restarting', async () => ({ ok: true })).ok === false; });
        return { ok: true };
    });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(refused, false, 'the restart queued while a job ran is not refused by that finished job');
    // Its end is recorded too (review 2026-10-07: a runtime file still naming a download's root after it ended let
    // `lol down` stop the vLLM someone else runs there): onSettled runs once the slot is free.
    let seenFree = null;
    jobs.runDownload('download', 'Downloading Fake', async () => ({ ok: true }), { onSettled: () => { seenFree = jobs.downloading() === null; } });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(seenFree, true);
    // The model download of the farm's own slot never blocks using another model; an install does (§3.5).
    const V = require('../src/vllm');
    const c = defaultConfig();
    const st = V.parseStatus(['home=/home/me', 'arch=x86_64', 'curl=/usr/bin/curl', 'gpu=NVIDIA RTX PRO 6000 Blackwell Workstation Edition, 97887, 90000, 12.0',
        'disk_free_kb=900000000', 'install=/home/me/lol-vllm 0.30.0', 'model=Qwen3.6-35B-A3B-NVFP4 23400000 vision=1 native=262144 partial=0', 'installing=77'].join('\n'));
    const probe = { platform: 'linux', arch: 'x64', st };
    const blocking = 'A download started earlier is still running. Wait for it, or stop it here.';
    assert.ok(!V.problemsFrom({ ...probe, installKind: 'download' }, c).problems.includes(blocking), 'downloading model Y never blocks using model X');
    assert.ok(V.problemsFrom({ ...probe, installKind: 'install' }, c).problems.includes(blocking));
    assert.ok(V.problemsFrom(probe, c).problems.includes(blocking), 'one nobody here started blocks too');
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.equal((upSrc.match(/d && d\.kind === 'install'\) return/g) || []).length, 2, 'Start and the switch to vLLM refuse while an install runs');
    assert.ok(upSrc.includes("if (dl && dl.kind === 'install') return { ok: false, message: 'vLLM is being installed: wait for it, or stop it.' }"), 'and so does every start');
});

test('the gate: while the farm\'s vLLM is not ready a generation gets 503 with why, after the password and before a seat (§3.10)', async () => {
    const http = require('http');
    const seatsMod = require('../src/seats');
    const upstream = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
    const seats = seatsMod.createSeats({ capacity: () => 4, idleReleaseSec: () => 900 });
    let down = 'This farm\'s model is starting: about 2 minutes. Try again then.';
    const gate = await seatsMod.startSeatGate({ host: '127.0.0.1', port: 0, upstreamPort: upstream.address().port, seats, idleReleaseSec: () => 900, password: () => 'pw', unavailable: () => down });
    const send = (method, p, key) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: gate.address().port, method, path: p, headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) } }, (res) => {
            let buf = ''; res.on('data', (ch) => { buf += ch; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
        });
        req.on('error', reject);
        req.end(method === 'POST' ? '{"model":"assistant","messages":[]}' : undefined);
    });
    try {
        assert.equal((await send('POST', '/v1/chat/completions', 'nope')).status, 401, 'the password is checked first');
        const r = await send('POST', '/v1/chat/completions', 'pw');
        assert.equal(r.status, 503);
        assert.equal(r.headers['retry-after'], '60');
        assert.equal(r.headers['access-control-allow-origin'], '*');
        assert.deepEqual(JSON.parse(r.body).error, { message: down, type: 'api_error', code: 'lol_engine_starting' });
        assert.equal(seats.view().length, 0, 'no seat is held for a model that is not there');
        assert.equal((await send('GET', '/v1/models', 'pw')).status, 200, 'the model list stays open');
        down = 'This farm\'s model is stopped for now. Try again later.';
        assert.equal(JSON.parse((await send('POST', '/v1/chat/completions', 'pw')).body).error.message, down);
        down = null;
        assert.equal((await send('POST', '/v1/chat/completions', 'pw')).status, 200, 'ready: through');
        assert.equal(seats.view().length, 1);
    } finally { gate.close(); upstream.close(); }
});

test('document reading beside vLLM uses gemma4:12b when it is installed; beside llama.cpp or an external server, its own choice (§1.4)', () => {
    const c = defaultConfig();
    c.models = [{ id: 'qwen3.8:latest', default: true, vision: true }];
    assert.equal(resolveOcrModel(c, ['qwen3.8:latest', 'gemma4:12b']), 'qwen3.8:latest', 'Ollama serves: its own default reads');
    c.vllm.enabled = true;
    assert.equal(resolveOcrModel(c, ['qwen3.8:latest', 'gemma4:12b']), 'gemma4:12b', 'vLLM serves: the model that fits the 9 GB kept for it');
    assert.equal(resolveOcrModel(c, ['qwen3.8:latest']), 'qwen3.8:latest', 'not installed: today\'s choice');
    assert.equal(resolveOcrModel(c), 'qwen3.8:latest');
    // Only beside vLLM, where the 9 GB reserve exists (review 2026-10-07): a llama.cpp farm chose its standby vision
    // default to fit beside llama-server, and an external server's farm keeps its own choice.
    c.vllm.enabled = false; c.llamacpp.enabled = true;
    c.models = [{ id: 'qwen3-vl:4b', default: true, vision: true }];
    assert.equal(resolveOcrModel(c, ['qwen3-vl:4b', 'gemma4:12b']), 'qwen3-vl:4b', 'llama.cpp: its own vision default');
    c.llamacpp.enabled = false; c.external.enabled = true;
    assert.equal(resolveOcrModel(c, ['qwen3-vl:4b', 'gemma4:12b']), 'qwen3-vl:4b', 'an external server: unchanged');
    c.external.enabled = false; c.vllm.enabled = true;
    c.ocr.model = 'mine:1b';
    assert.equal(resolveOcrModel(c, ['gemma4:12b']), 'mine:1b', 'an explicit choice wins');
});

test('vLLM plumbing helpers: the distribution\'s disk folder, install steps and download failures in plain words', () => {
    const V = require('../src/vllm');
    const reg = [
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss',
        '    DefaultDistribution    REG_SZ    {919701f6}',
        '',
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{1111}',
        '    BasePath    REG_SZ    \\\\?\\D:\\wsl\\docker',
        '    DistributionName    REG_SZ    docker-desktop',
        '',
        'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss\\{919701f6}',
        '    DistributionName    REG_SZ    Ubuntu',
        '    Version    REG_DWORD    0x2',
        '    BasePath    REG_SZ    C:\\Users\\me\\AppData\\Local\\wsl\\{919701f6}',
    ].join('\r\n');
    assert.equal(V.lxssBasePath(reg, 'Ubuntu'), 'C:\\Users\\me\\AppData\\Local\\wsl\\{919701f6}');
    assert.equal(V.lxssBasePath(reg, 'docker-desktop'), 'D:\\wsl\\docker', 'the \\\\?\\ prefix goes');
    assert.equal(V.lxssBasePath(reg, 'Debian'), null);
    assert.equal(V.installStepText('vllm', { version: '0.30.0' }), 'downloading vLLM 0.30.0 and its GPU libraries (about 8 GB)');
    // The meter is the folder on disk, which Hugging Face's downloader fills in large pieces, late (the live test):
    // the text says the number jumps, so a low one does not read as stuck.
    assert.equal(V.installStepText('model', { label: 'Qwen3.6', bytes: 12.34e9, total: 23.4e9 }), 'downloading Qwen3.6 — 12 of 23 GB on disk so far (files are written in large pieces, so this number jumps)');
    assert.equal(V.installStepText('model', { label: 'Qwen3.6', bytes: 1.25e9, total: 2.5e9 }), 'downloading Qwen3.6 — 1.3 of 2.5 GB on disk so far (files are written in large pieces, so this number jumps)');
    assert.equal(V.installStepText('cuda-pins'), 'matching the CUDA compiler to the GPU libraries');
    assert.equal(V.downloadFailure({ kind: 'gated' }, 'a/b'), 'Hugging Face asks for an account to download this model. Pick another model.');
    assert.equal(V.downloadFailure({ kind: 'notfound' }, 'a/b'), 'There is no model named a/b on Hugging Face. Check the name.');
    assert.equal(V.downloadFailure({ kind: 'disk' }, 'a/b'), 'The disk is full. Free some space, then press Download again.');
    assert.equal(V.downloadFailure({ kind: 'network', error: 'httpx.ReadTimeout: The read operation timed out' }, 'a/b'), 'The download stopped: The read operation timed out. Press Download again to go on: the files it finished are kept.');
    // The share path a log is read through, never through a shell.
    assert.equal(V.logFile({ platform: 'win32', distro: 'Ubuntu', root: '/home/me/lol-vllm' }), '\\\\wsl.localhost\\Ubuntu\\home\\me\\lol-vllm\\logs\\vllm.log');
    assert.equal(V.logFile({ platform: 'linux', root: '/home/me/lol-vllm' }), '/home/me/lol-vllm/logs/vllm.log');
    assert.equal(V.logFile({ platform: 'linux', root: '~/lol-vllm' }), null, 'only an absolute root');
});

// ---- vLLM, run by the farm: the panel and its admin controls (slice C: §11.1 items 17-18) ----------------------

// The checks of this computer the panel tests work from: an RTX PRO 6000 with Qwen3.6 and Nemotron downloaded.
const proStatus = () => V.parseStatus(['home=/home/me', 'arch=x86_64', 'curl=/usr/bin/curl', `gpu=${PRO}, 97887, 90000, 12.0`,
    'disk_free_kb=900000000', 'install=/home/me/lol-vllm 0.30.0',
    'model=Qwen3.6-35B-A3B-NVFP4 23400000 vision=1 native=262144 partial=0',
    'model=NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4 21600000 vision=0 native=262144 partial=0',
    'model=Qwen3.8-27B-NVFP4 9000000 vision=1 native=262144 partial=1'].join('\n'));

test('vLLM Apply: what restarts it is decided against what it runs with — 48 → 40 people no, 48 → 80 yes, a context yes, a name no, Automatic memory kept (§5.6, §11.1-17)', () => {
    const c = defaultConfig();
    c.vllm.enabled = true; c.vllm.root = '/home/me/lol-vllm'; c.vllm.parallel = 48;
    const st = proStatus();
    // What production runs: 48 people, Automatic memory resolved to 50 GiB, vLLM's own cap 128.
    const launch = { ...V.settingsOf(c, '/home/me/lol-vllm'), kvGib: 50, maxNumSeqs: 128, seats: 48 };
    const ch = (body, l = launch) => V.applyChange(c, body, { st, launch: l, root: '/home/me/lol-vllm' });
    assert.equal(ch({ slots: 40 }).restart, false, '48 → 40: inside the cap of 128 requests, applied live');
    assert.deepEqual(ch({ slots: 40 }).patch, { parallel: 40 });
    assert.equal(ch({ slots: 80 }).restart, true, '48 → 80: the cap goes 128 → 256, a restart');
    assert.equal(ch({ context: 32768 }).restart, true, 'a context restarts');
    assert.equal(ch({ name: 'Studio' }).restart, false, 'a name does not');
    assert.deepEqual(ch({ name: 'Studio' }).changes, ['name "Studio"']);
    assert.deepEqual(ch({ kvCacheGib: 'auto' }), { patch: {}, restart: false, seats: 48, changes: [] }, 'Automatic → Automatic: nothing (D9: never worked out again while it runs)');
    assert.equal(ch({ kvCacheGib: 40 }).restart, true, 'a set amount other than what it runs with');
    assert.equal(ch({ kvCacheGib: 50 }).restart, false, 'the amount it runs with, now set: the same launch');
    assert.equal(ch({ model: 'nemotron-3.5-lightning' }).restart, true, 'another model');
    assert.deepEqual(ch({ slots: 'auto' }).patch, { parallel: 'auto' });
    assert.equal(ch({ slots: 'auto' }).restart, false, 'Automatic at 64k with 50 GiB is the measured 48: the same cap');
    // Not running: every change is saved for the next start.
    for (const b of [{ slots: 80 }, { context: 32768 }, { kvCacheGib: 40 }]) assert.equal(ch(b, null).restart, false, JSON.stringify(b));
    // Refused, with what to do.
    assert.match(ch({ slots: 0 }).error, /Automatic, or between 1 and 512/);
    assert.match(ch({ slots: 600 }).error, /between 1 and 512/);
    assert.match(ch({ context: 2048 }).error, /between 4096 and 262144 tokens \(this model's maximum\)/);
    assert.match(ch({ context: 524288 }).error, /this model's maximum/);
    assert.match(ch({ kvCacheGib: 200 }).error, /between 1 and 95 GB/);
    assert.equal(ch({ model: 'nope' }).error, 'That model is not in the vLLM list.');
    assert.equal(ch({ model: 'qwen3.8-27b-nvfp4' }).error, 'Qwen3.8 27B · NVFP4 is not downloaded yet: press Download next to it.', 'partly downloaded is not downloaded');
    assert.match(ch({ kvCacheGib: 1, context: 262144 }).error, /less than one person's conversation needs at this context/);
    // Another model that reads less than the context per person: refused, unless the context comes with it.
    const small = { id: 'small', label: 'Small', folder: 'small', repo: null, args: ['--enable-prefix-caching'] };
    const c2 = { ...c, vllm: { ...c.vllm, library: [...c.vllm.library, small] } };
    const st2 = { ...st, models: [...st.models, { folder: 'small', gb: 1, vision: false, native: 4096, partial: false }] };
    assert.equal(V.applyChange(c2, { model: 'small' }, { st: st2, launch }).error, 'Small reads at most 4096 tokens: choose a context per person of 4096 or less with it.');
    assert.deepEqual(V.applyChange(c2, { model: 'small', context: 4096 }, { st: st2, launch }).patch, { model: 'small', contextLength: 4096 });
    // up.js runs exactly this decision (the logic lives in vllm.js, §3.5).
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(/vllmMod\.applyChange\(config, \{ \.\.\.body, name \}, \{ st, launch: running \? L : null/.test(upSrc), 'applyVllmSettings uses applyChange');
    assert.ok(/if \(body\.dryRun\) return \{ ok: true, dryRun: true, restart, changes/.test(upSrc), 'and answers a dry run with it');
});

test('the vLLM list: a model added by name or link gets its family\'s flags, a folder on disk too, never twice (§4.4)', () => {
    const lib = defaultConfig().vllm.library;
    assert.equal(V.repoOf('nvidia/Qwen3.6-35B-A3B-NVFP4'), 'nvidia/Qwen3.6-35B-A3B-NVFP4');
    assert.equal(V.repoOf('https://huggingface.co/Qwen/Qwen3-0.6B/tree/main'), 'Qwen/Qwen3-0.6B');
    assert.equal(V.repoOf('https://huggingface.co/Qwen/Qwen3-0.6B'), 'Qwen/Qwen3-0.6B');
    for (const bad of ['', 'qwen', 'https://example.com/a/b', 'a b/c', '../x/y']) assert.equal(V.repoOf(bad), null, bad);
    // Families: the measured models' own flags for theirs; a generic Qwen3 set; else prefix caching only.
    assert.deepEqual(V.familyArgs('nvidia/Qwen3.5-122B-A10B-NVFP4'), lib[0].args);
    assert.deepEqual(V.familyArgs('nvidia/Qwen3.8-14B-NVFP4'), lib[2].args);
    assert.deepEqual(V.familyArgs('nvidia/NVIDIA-Nemotron-Nano-9B'), lib[1].args);
    assert.deepEqual(V.familyArgs('Qwen/Qwen3-0.6B'), ['--enable-prefix-caching', '--reasoning-parser', 'qwen3', '--enable-auto-tool-choice', '--tool-call-parser', 'hermes']);
    assert.deepEqual(V.familyArgs('mistralai/Mistral-Small'), ['--enable-prefix-caching']);
    assert.ok(V.isGeneric({ args: ['--enable-prefix-caching'] }) && !V.isGeneric(lib[0]), 'no thinking parser: the panel says tools and thinking may not show');
    const a = V.newLibraryEntry({ repo: 'https://huggingface.co/Qwen/Qwen3-0.6B' }, lib);
    assert.equal(a.entry.id, 'qwen3-0.6b');
    assert.equal(a.entry.label, 'Qwen3-0.6B');
    assert.equal(a.entry.repo, 'Qwen/Qwen3-0.6B');
    assert.equal(a.entry.folder, null, 'its folder is the repo\'s name');
    // What it adds boots: the strict schema takes it.
    assert.ok(ConfigSchema.safeParse({ vllm: { library: [...lib, a.entry] } }).success, 'the strict schema accepts the new entry');
    assert.equal(V.newLibraryEntry({ repo: 'nvidia/qwen3.6-35b-a3b-nvfp4' }, lib).error, 'nvidia/qwen3.6-35b-a3b-nvfp4 is already in the list.');
    assert.match(V.newLibraryEntry({ repo: 'not a model' }, lib).error, /Give the name of a model on Hugging Face/);
    // Another owner's model of the same name gets its own folder; a slug already taken gets a number.
    const twin = V.newLibraryEntry({ repo: 'someone/Qwen3.6-35B-A3B-NVFP4' }, lib).entry;
    assert.equal(twin.folder, 'someone--Qwen3.6-35B-A3B-NVFP4');
    assert.equal(twin.id, 'qwen3.6-35b-a3b-nvfp4');
    assert.equal(V.newLibraryEntry({ repo: 'other/qwen3.6-35b-a3b' }, lib).entry.id, 'qwen3.6-35b-a3b-2');
    // A folder found on this computer: its size and whether it sees images come from the check.
    const f = V.newLibraryEntry({ folder: 'my-model' }, lib, [{ folder: 'my-model', gb: 12.34, vision: true }]).entry;
    assert.deepEqual([f.repo, f.folder, f.sizeGb, f.vision, f.label], [null, 'my-model', 12, true, 'my-model']);
    assert.equal(V.newLibraryEntry({ folder: '..' }, lib).error, 'That is not a model folder.');
    assert.equal(V.newLibraryEntry({ folder: 'Qwen3.6-35B-A3B-NVFP4' }, lib).error, 'Qwen3.6-35B-A3B-NVFP4 is already in the list.');
});

test('document reading beside vLLM: its model fits the memory kept for it, or the Performance card says so (§1.4, §7.6)', () => {
    assert.deepEqual(V.ocrFit({ sizeBytes: 7.6e9, reserveGib: 9 }), { gb: 8.1, fits: true }, 'gemma4:12b on disk + 1 GiB');
    assert.deepEqual(V.ocrFit({ sizeBytes: 17.7e9, reserveGib: 9 }), { gb: 17, fits: false }, 'production\'s qwen3.8:latest');
    assert.deepEqual(V.ocrFit({ sizeBytes: 7.6e9, vramBytes: 10.5 * GIB, reserveGib: 9 }), { gb: 11, fits: false }, 'loaded: what it holds in the GPU');
    assert.equal(V.ocrFit({ reserveGib: 9 }), null, 'unknown size: no verdict');
    const render = loadPanel();
    const vstate = (over) => adminState({ backend: { engine: 'vllm', alias: 'Qwen3.6', model: 'Qwen3.6', contextLength: 65536, contextPerSlot: 65536, slots: 48, slotsVerified: true },
        vllm: { ...vllmPanel(), ocrReserveGib: 9 }, ...over });
    const html = render(vstate({ ocrModel: 'qwen3.8:latest', ocrFits: false, ocrGb: 18.7 }));
    assert.ok(html.includes('Document reading uses qwen3.8:latest (18.7 GB), which does not fit the 9 GB kept for it beside vLLM: documents will read slowly. Download gemma4:12b in the Ollama list below; the farm then uses it.'), 'the warning with what to do');
    assert.ok(render(vstate({ ocrModel: 'gemma4:12b', ocrFits: false, ocrGb: 11 })).includes('documents will read slowly.</div>'), 'already gemma4:12b: no advice to download it');
    assert.ok(!render(vstate({ ocrModel: 'gemma4:12b', ocrFits: true, ocrGb: 8.1 })).includes('Document reading uses'));
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(/ocrFits: ocrSize \? ocrSize\.fits : null/.test(upSrc) && /reserveGib: config\.vllm\.ocrReserveGib/.test(upSrc), 'the admin state carries it');
});

// The vLLM part of /lol/admin/state as up.js vllmAdminState gives it: production's farm, adopted and ready.
function vllmPanel(over = {}) {
    const lib = defaultConfig().vllm.library.map((e, i) => ({ ...e, downloaded: i < 2, partial: false, gbOnDisk: i < 2 ? e.sizeGb : null, active: i === 0, generic: false }));
    return {
        enabled: true, supported: true, installed: true, version: '0.30.0', pinned: '0.30.0', root: '/home/me/lol-spike', distro: 'Ubuntu', port: 8100, hostDrive: 'C',
        probe: { at: Date.now(), oks: ['WSL is installed, with Ubuntu on WSL 2.', `Ubuntu sees the GPU: ${PRO} (96 GB).`, 'vLLM 0.30.0 is installed (in /home/me/lol-spike).'], problems: [], warnings: [] },
        alias: 'Qwen3.6', model: 'qwen3.6-35b-a3b', library: lib, foundFolders: [],
        contextLength: 65536, parallel: 'auto', parallelResolved: 48, maxNumSeqs: 'auto', maxNumSeqsResolved: 128, kvCacheGib: 'auto', kvResolvedGib: 50,
        phase: 'ready', phaseText: null, percent: null, adopted: false, bootError: null, poolTokens: 4313303, peopleFit: 65, guardLine: null, running: true,
        measured: V.measuredFor(defaultConfig().vllm.library[0], PRO), launchSettings: null,
        facts: V.facts(defaultConfig().vllm.library[0]), autoKvGib: 50, seatsAuto: { seats: 48, source: 'measured', label: '48' },
        cardGib: 95.6, unified: false, ocrReserveGib: 9, minFreeGb: null, installable: true, venvLink: false, installing: false, takeOver: null,
        ...over,
    };
}
const vllmBackend = { engine: 'vllm', alias: 'Qwen3.6', model: 'Qwen3.6 35B-A3B · NVFP4', contextLength: 65536, contextPerSlot: 65536, contextAuto: false, slots: 48, slotsVerified: true };
const vllmState = (v = {}, over = {}) => adminState({ backend: vllmBackend, vllm: vllmPanel(v), externalConfigured: false,
    capacity: { slots: 48, clients: 12, seats: [], seatIdleSec: 900, slotsVerified: true, unmanagedHosts: [], ollamaEnvAdvice: null }, ...over });
const ollamaWithVllm = (v = {}, over = {}) => adminState({ vllm: vllmPanel({ enabled: false, phase: null, running: false, adopted: false, ...v }), externalConfigured: false, ...over });

test('panel: the engine grid — Ollama, llama.cpp, vLLM, and External only while a developer configured one; vLLM\'s button by what this computer has (§7.1, §11.1-18)', async () => {
    const render = loadPanel();
    const engines = (html) => [...html.matchAll(/data-engine="(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(engines(render(ollamaWithVllm())), ['ollama', 'llamacpp', 'vllm'], 'three buttons');
    const ext = render(ollamaWithVllm({}, { externalConfigured: true }));
    assert.deepEqual(engines(ext), ['ollama', 'llamacpp', 'vllm', 'external'], 'four only while the file holds an external server');
    assert.ok(ext.includes('A server this farm does not run, set up by a developer.'));
    const html = render(ollamaWithVllm());
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8').includes('.engines { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));'), 'three or four buttons fit one grid');
    assert.ok(html.includes('The models below. Several to choose from, for a few people at once.'));
    assert.ok(html.includes('Many people at once on a big NVIDIA GPU. One model; it takes about 2 minutes to start.'), 'ready to use');
    assert.ok(render(ollamaWithVllm({ probe: { at: 1, oks: [], problems: ['vLLM is not installed on this computer yet: press Install vLLM.'], warnings: [] } }))
        .includes('Many people at once on a big NVIDIA GPU. Not set up on this computer yet: press to see how.'), 'not set up');
    assert.ok(render(ollamaWithVllm({ probe: null })).includes('Many people at once on a big NVIDIA GPU. Press to check this computer.'), 'not checked yet: no guess');
    const unsup = render(ollamaWithVllm({ supported: false, probe: null }));
    assert.ok(unsup.includes('Not available on this computer: vLLM needs an NVIDIA GPU on Linux, or Windows with WSL.'));
    assert.ok(/data-engine="vllm" disabled/.test(unsup), 'unsupported: the button is off');
    assert.ok(render(ollamaWithVllm({}, { llamacppAvailable: false })).includes('Not available on this computer: there is no ready-made llama.cpp for it.'));
    assert.ok(html.includes('Switching stops the current engine and starts the other: about a minute for Ollama or llama.cpp, about 2 minutes for vLLM.'));
    // The active engine's badge says where vLLM is in its life.
    const badge = (phase) => (/data-engine="vllm"[^>]*><div class="mname">vLLM <span class="badge on">([^<]+)</.exec(render(vllmState({ phase }))) || [])[1];
    assert.deepEqual(['ready', 'starting', 'stopped', 'guard', 'down'].map(badge), ['running', 'starting', 'stopped', 'stopped', 'not answering']);
    // Switching away from an external server is allowed now (§1.2): its buttons are live.
    const extServing = render(adminState({ backend: { engine: 'external', alias: 'a', model: 'm', baseUrl: 'http://127.0.0.1:8100/v1', contextLength: 65536, contextPerSlot: 65536, slots: 48, slotsVerified: false },
        externalConfigured: true, vllm: vllmPanel({ enabled: false, phase: null, probe: null }) }));
    assert.ok(/data-engine="ollama">/.test(extServing) && /data-engine="vllm">/.test(extServing), 'not disabled under an external server');
    assert.ok(extServing.includes('Serving through a server this farm does not run, at <b>http://127.0.0.1:8100/v1</b>. Its model, context and people at once are set where that server runs. To serve from this farm instead, pick Ollama, llama.cpp or vLLM above.'));
    // What each switch costs, said before it (§7.1, §1.2).
    const sc = render.switchConfirm;
    assert.equal(sc(ollamaWithVllm(), 'vllm'), 'Switch to vLLM? Chat stops for about 2 minutes while vLLM loads the model (longer the very first time, while it prepares the GPU).');
    assert.equal(sc(vllmState(), 'ollama'), 'Switch to Ollama? vLLM stops and Ollama loads its model: about a minute, and anyone connected waits.');
    assert.equal(sc(vllmState(), 'llamacpp'), 'Switch to llama.cpp? vLLM stops and llama.cpp loads its model: about a minute, and anyone connected waits.');
    const extState = adminState({ backend: { engine: 'external', baseUrl: 'http://127.0.0.1:8100/v1' }, health: { gpu: { vramUsedGb: 75, vramTotalGb: 96 } }, vllm: vllmPanel() });
    assert.equal(sc(extState, 'ollama'), 'Switch to Ollama? Ollama loads its model: about a minute, and anyone connected waits. The server at http://127.0.0.1:8100/v1 keeps running and keeps its share of the GPU: Ollama gets only what is left (21 GB free now).');
    assert.equal(sc(extState, 'vllm'), 'Switch to vLLM? Chat stops for about 2 minutes while vLLM loads the model (longer the very first time, while it prepares the GPU). The server at http://127.0.0.1:8100/v1 keeps running and keeps its share of the GPU: vLLM gets only what is left (21 GB free now).');
    assert.equal(sc({ ...extState, backend: { engine: 'external', baseUrl: 'http://10.0.0.5:8000/v1' } }, 'ollama'), 'Switch to Ollama? Ollama loads its model: about a minute, and anyone connected waits.', 'another machine keeps its own GPU');
    // A take-over offered (production before it, review 2026-10-07): a switch away still says the server keeps its
    // GPU share, and how to keep it serving instead; the vLLM button IS the take-over, with nothing restarted.
    const offered = { ...extState, vllm: vllmPanel({ probe: null, takeOver: { root: '/r', running: true } }) };
    assert.equal(sc(offered, 'llamacpp'), 'Switch to llama.cpp? llama.cpp loads its model: about a minute, and anyone connected waits. The server at http://127.0.0.1:8100/v1 keeps running and keeps its share of the GPU: llama.cpp gets only what is left (21 GB free now). To keep it serving as this farm\'s own vLLM instead, press Let the farm run vLLM.');
    assert.ok(render(offered).includes('Many people at once on a big NVIDIA GPU. The vLLM already on this computer: press to let the farm run it, as it runs now.'));
    const posts = []; const asked = [];
    const p = loadPanel({ fetch: async (url, o) => { posts.push([url, o && o.body ? JSON.parse(o.body) : null]); return { status: 200, json: async () => ({ ok: true }) }; }, confirm: (q) => { asked.push(q); return true; } });
    p(offered);
    p.engineClick(offered, 'vllm', { dataset: {} });
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(asked, ['Let the farm run the vLLM already on this computer? It keeps the same model, name and settings and keeps running: nobody is interrupted.']);
    assert.deepEqual(posts.filter(([u]) => u !== '/lol/admin/state').map(([u]) => u), ['/lol/admin/vllm/take-over'], 'not a switch: the take-over');
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(/if \(want === 'vllm' && from === 'external' && takeOverOffer\) return serialize\(\(\) => vllmTakeOverRun\(\)\);/.test(upSrc), 'the farm does the same for a switch asked any other way');
    assert.ok(/return !\(engineOf\(config\) === 'vllm' && loopbackPort\(config\.external\.baseUrl\) === config\.vllm\.port\);/.test(upSrc), 'no External button pointing at the vLLM the farm runs');
});

test('panel: a GPU vLLM cannot use says so on its button, before any check; its card closes; the take-over on Linux says when vLLM starts (review 2026-10-07)', async () => {
    const render = loadPanel();
    const sub = (html) => (/data-engine="vllm"[\s\S]*?<\/button>/.exec(html) || [''])[0];
    // The studio's RTX 4070 / 4080: what nvidia-smi showed at boot is enough to say it, with no offer to set it up.
    const small = sub(render(ollamaWithVllm({ probe: null, hostFit: { gb: 12, fits: false, needGb: 35 } })));
    assert.ok(small.includes('Not for this GPU (12 GB; vLLM&#39;s models need about 35 GB): llama.cpp or Ollama is the engine for it. Press to see why.')
        || small.includes("Not for this GPU (12 GB; vLLM's models need about 35 GB): llama.cpp or Ollama is the engine for it. Press to see why."), small);
    assert.ok(!/set up|check this computer/i.test(small), small);
    assert.ok(sub(render(ollamaWithVllm({ probe: { at: 1, oks: [], problems: ['x'], warnings: [], gpuTooSmall: true }, hostFit: null }))).includes('Not for this GPU: llama.cpp or Ollama is the engine for it.'), 'the check says it too');
    assert.ok(sub(render(ollamaWithVllm({ probe: null, hostFit: null, noNvidia: true }))).includes('vLLM needs an NVIDIA GPU, and none was found on this computer. Press to check it.'));
    assert.ok(sub(render(ollamaWithVllm({ probe: null, hostFit: { gb: 96, fits: true, needGb: 35 } }))).includes('Many people at once on a big NVIDIA GPU. Press to check this computer.'), 'a PRO 6000: as before');
    // The card a press opened closes again (it is remembered in this browser, and showed a small GPU's red list on
    // every page); not while vLLM is the engine.
    const card = (html) => (/<h2>Model · vLLM<\/h2>[\s\S]*?(?=<div class="card"><h2>|$)/.exec(html) || [''])[0];
    const p = loadPanel({ fetch: async () => ({ status: 200, json: async () => ({ ok: true }) }) });
    const s = ollamaWithVllm({ probe: { at: 1, oks: [], problems: ['This GPU has 12 GB: too little'], warnings: [], gpuTooSmall: true } });
    assert.equal(card(p(s)), '', 'closed until pressed');
    p.engineClick(s, 'vllm', { dataset: {} });
    assert.ok(card(p.el('#app').innerHTML).includes('data-vclose'), 'opened by the press: Close');
    assert.ok(!card(render(vllmState())).includes('data-vclose'), 'the engine: no Close');
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8').includes("try { localStorage.removeItem('lolVllmOpen'); } catch { /* private window */ }"), 'Close forgets it');
    // On Linux (a DGX Spark) the take-over makes the boot service a no-op: before the click, the panel says vLLM then
    // starts with the farm, which the Farm app does at a desktop log-in.
    const LINUX = 'From then on vLLM starts when the farm starts, not by itself at boot: with the Farm app, that is when someone logs in to the desktop of this computer (Launch at login, in its settings).';
    const ext = (platform) => adminState({ backend: { engine: 'external', baseUrl: 'http://127.0.0.1:8100/v1' }, vllm: vllmPanel({ takeOver: { root: '/home/me/lol-vllm', running: true, platform } }) });
    assert.ok(render(ext('linux')).includes(LINUX));
    assert.ok(!render(ext('win32')).includes(LINUX));
    const asked = [];
    const q = loadPanel({ fetch: async () => ({ status: 200, json: async () => ({ ok: true }) }), confirm: (x) => { asked.push(x); return false; } });
    q(ext('linux')); q.engineClick(ext('linux'), 'vllm', { dataset: {} });
    assert.ok(asked[0] && asked[0].endsWith(LINUX), asked[0]);
});

test('free memory is read until it stops rising, before a start sizes against it (review 2026-10-07)', async () => {
    const { untilSteady } = require('../src/systemInfo');
    const seq = (xs) => { let i = 0; return async () => xs[Math.min(i++, xs.length - 1)]; };
    assert.equal(await untilSteady(seq([20, 50, 80, 95, 95.1]), { gapMs: 1 }), 95, 'a vLLM stopped a moment ago gives its memory back');
    assert.equal(await untilSteady(seq([95, 95]), { gapMs: 1 }), 95, 'steady: one more read');
    assert.equal(await untilSteady(seq([null]), { gapMs: 1 }), null);
    assert.equal(await untilSteady(seq([10, 20, 30, 40, 50, 60, 70, 80]), { gapMs: 1, tries: 3 }), 40, 'at most `tries` more reads');
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(/if \(config\.vllm\.kvCacheGib === 'auto' && vllmProbe\.st\) \{\s+let first = true;\s+await untilSteady\(/.test(upSrc), 'a vLLM start with Automatic memory waits for it');
    assert.ok(upSrc.includes('const free = await untilSteady(gpuFreeGb);'), 'llama.cpp\'s too, through the same function');
});

test('`lol down` during a proxy bounce or a vLLM stop: the farm stops as asked, never restarts vLLM nor writes its runtime file back (review 2026-10-07)', () => {
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(upSrc.includes('if (runtimeWritten && !readRuntime()) return;'), 'writeRuntimeState never writes it back');
    assert.ok(/function onVllmDown\(why, detail = null\) \{\s+if \(stopping \|\| vllmDownRunning \|\| engineOf\(config\) !== 'vllm'\) return;\s+if \(downAsked\(\)\) return;/.test(upSrc), 'a vLLM that stops after `lol down` is not restarted');
    assert.ok(upSrc.includes("if (!readRuntime()) { restartingProxy = false; shutdown('lol down'); return false; }"), 'a bounce that lands after `lol down` stops the farm');
    // ...and the Apply that bounced it, going back to the previous settings, never starts a vLLM (or loads Ollama) on
    // the farm's way out: it would outlive the farm.
    assert.ok(/async function startVllm\([\s\S]{0,450}?if \(quitting\(\)\) return quitting\(\);\s+const dl = jobs\.downloading\(\);/.test(upSrc), 'no start while the farm stops');
    assert.ok(/if \(quitting\(\)\) return quitting\(\);\s+log\.step\(`vLLM: starting /.test(upSrc), 'nor right before the spawn');
    assert.ok(/async function fallbackToOllama\([^)]*\) \{\s+if \(stopping\) return false;/.test(upSrc), 'no fallback while the farm stops');
    // Ollama leaves the GPU before a start found in progress too (review 2026-10-07: the waitOnly path skipped it).
    assert.ok(/await evictOllama\(say\);\s+if \(!waitOnly\) \{/.test(upSrc), 'evicted before the waitOnly branch');
    // The Farm app's Stop says what a vLLM farm costs (review 2026-10-07).
    assert.ok(fs.readFileSync(path.join(__dirname, '..', '..', 'farm-app', 'renderer', 'app.js'), 'utf8').includes("confirm('Stop the farm? Everyone connected loses their chat mid-answer. A farm that serves with vLLM takes about 2 minutes to start again.')"));
});

test('panel: vLLM\'s line for each phase, its hero, and a start that fell back to Ollama (§1.5, §7.1)', () => {
    const render = loadPanel();
    const html = render(vllmState({ adopted: true }));
    assert.ok(html.includes('<div class="hero-meta">vLLM · Qwen3.6 35B-A3B · NVFP4</div>'));
    assert.ok(html.includes('48 people at once · 64k of context each · <b>12</b> connected now'));
    assert.ok(html.includes('vLLM was already running with these settings, so the farm kept it running.'), 'adopted');
    assert.ok(!render(vllmState()).includes('already running with these settings'), 'started by the farm: no line');
    assert.ok(render(vllmState({ phase: 'starting', phaseText: 'loading the model weights (2 of 3)' })).includes(
        'vLLM is starting: loading the model weights (2 of 3). About 2 minutes, longer the first time. Until it is ready, people connected see “Starting vLLM”, and a message sent meanwhile is answered that the model is starting, to try again in about 2 minutes.'));
    // What clients show is the job's own label (review 2026-10-07): a switch or an Apply is not "Starting vLLM".
    for (const label of ['Switching to vLLM', 'Applying the farm settings']) {
        assert.ok(render(vllmState({ phase: 'starting', phaseText: 'starting vLLM' }, { job: { kind: 'backend', label, message: 'x', done: false } })).includes(`people connected see “${label}”`), label);
    }
    // An unplanned restart: the farm says it is unhealthy, so clients see a problem and may leave.
    assert.ok(render(vllmState({ phase: 'restarting', phaseText: 'capturing GPU graphs' })).includes(
        '<div class="warnline">vLLM stopped unexpectedly and is starting again: capturing GPU graphs. About 2 minutes. Until it is ready nobody can chat here: people connected see a problem on this farm and may move to another one, and a message sent meanwhile is answered to try again later.</div>'));
    assert.ok(render(vllmState({ phase: 'stopped' })).includes('<div class="warnline">vLLM is stopped, so nobody can chat. Press Start vLLM below, or switch to another engine.</div>'));
    // A vLLM that could not serve and did not stop either: the farm stays on it, stopped, and says why.
    const stuck = 'vLLM could not start: x. The farm could not stop what is left of it (vLLM did not stop: it is still running), so it does not start Ollama beside it: press Start vLLM to try again, or switch to another engine.';
    assert.ok(render(vllmState({ phase: 'stopped', phaseText: stuck })).includes(`<div class="warnline">${stuck}</div>`));
    const guard = 'vLLM was stopped because this computer was running out of memory (6 GB left; it stops below 8 GB, before the GPU gets stuck at a slow speed). Close what is using the memory, then press Start vLLM.';
    assert.ok(render(vllmState({ phase: 'guard', phaseText: guard })).includes(`<div class="warnline">${guard}</div>`));
    assert.ok(render(vllmState({ phase: 'down' })).includes('vLLM is not answering. The farm is checking it.'));
    // Fell back: Ollama serves, with vLLM's reason, once.
    const failed = render(ollamaWithVllm({ phase: 'failed', bootErrorRan: true, bootError: 'vLLM could not start: vLLM ran out of GPU memory while starting. Lower GPU memory for conversations or the context.' }));
    assert.ok(failed.includes('<div class="warnline">vLLM could not start: vLLM ran out of GPU memory while starting. Lower GPU memory for conversations or the context. The farm serves with Ollama for now. Fix the cause (vLLM\'s log below says more), then switch back to vLLM.</div>'), failed.slice(0, 600));
    // vLLM never ran (the boot's check, or a start that stopped at its check): its log says nothing about it, the
    // checklist does (verifier, 2026-10-08); with nothing on the checklist, neither is named.
    const missing = 'vLLM is not installed on this computer yet: press Install vLLM.';
    const never = render(ollamaWithVllm({ bootError: missing, probe: { at: 1, oks: [], problems: [missing], warnings: [] } }));
    assert.ok(never.includes(`<div class="warnline">vLLM could not start: ${missing.slice(0, -1)}. The farm serves with Ollama for now. Fix the cause (the checklist on the vLLM card below says what is missing), then switch back to vLLM.</div>`), never.slice(0, 600));
    assert.ok(!never.includes('log below says more'));
    const portTaken = render(ollamaWithVllm({ phase: 'failed', bootError: 'vLLM could not start: Another program uses port 8100, maybe a vLLM started outside the farm. Stop it, then press Start vLLM.' }));
    assert.ok(portTaken.includes('The farm serves with Ollama for now. Fix the cause, then switch back to vLLM.</div>'), portTaken.slice(0, 600));
    const upSrc0 = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    // The farm says which: a failure once vLLM ran (its start, a crash while it served), not one at the check.
    assert.ok(upSrc0.includes('ok: false, code: r.code, portIsOthers, ran: true,') && upSrc0.includes("{ portIsOthers: !!r.portIsOthers, ran: !!r.ran }")
        && upSrc0.includes('(the second time, ${why}).`, { ran: true });') && upSrc0.includes('vllmBootError = reason; vllmBootErrorRan = ran;')
        && upSrc0.includes('bootError: vllmBootError, bootErrorRan: vllmBootErrorRan,'));
    // vLLM that stopped working while it served (twice in 5 minutes) is not "could not start", and says it in plain
    // words (the live test read "(the second time, its process ended (status 0))").
    const crashed = render(ollamaWithVllm({ phase: 'failed', bootErrorRan: true, bootError: 'vLLM stopped working twice in 5 minutes (the second time, it shut down by itself).' }));
    assert.ok(crashed.includes('<div class="warnline">vLLM stopped working twice in 5 minutes (the second time, it shut down by itself). The farm serves with Ollama for now.'), crashed.slice(0, 600));
    assert.ok(!crashed.includes('could not start') && !/status \d/.test(crashed));
    assert.ok(upSrc0.includes("onVllmDown('it shut down by itself', `status ${code}`);") && upSrc0.includes('`vLLM stopped working twice in 5 minutes (the second time, ${why}).`'), 'the farm writes it so; the status goes to its log only');
    assert.ok(failed.includes('<h2>Model · vLLM</h2>'), 'its card stays, for the log');
    assert.ok(!render(adminState({ backend: { engine: 'llama.cpp', alias: 'a', model: 'm', contextLength: 8192, contextPerSlot: 8192, slots: 1 }, vllm: vllmPanel({ bootError: 'x', enabled: false }) })).includes('The farm serves with Ollama for now'), 'only while Ollama serves');
});

test('panel: the vLLM card — the checklist, Install only when not installed, Download / Use this / Remove by state, Start, Stop, the log, the take-over offer (§7.2, §9.2, §11.1-18)', () => {
    const render = loadPanel();
    const card = (html) => (/<h2>Model · vLLM<\/h2>[\s\S]*?(?=<div class="card"><h2>)/.exec(html) || [''])[0];
    assert.equal(card(render(ollamaWithVllm())), '', 'not shown while another engine serves and nobody asked');
    const c = card(render(vllmState()));
    assert.ok(c.includes('vLLM is an engine made for serving many people at once on a big NVIDIA GPU. On Windows it runs inside WSL, the Linux that comes with Windows. The farm installs it, starts it and stops it.'));
    assert.ok(c.includes('<div class="meta">✓ WSL is installed, with Ubuntu on WSL 2.</div>'), 'what is in place, muted');
    assert.ok(c.includes('data-vcheck') && c.includes('Check again'));
    assert.ok(!c.includes('data-vinstall'), 'installed: no Install');
    // The list: the one serving, one downloaded (Use this, Remove), one to download.
    assert.ok(/Qwen3\.6 35B-A3B · NVFP4<\/div>[\s\S]*?<span class="badge on">serving<\/span><span class="badge">downloaded<\/span><\/span>/.test(c), 'serving + downloaded, no buttons');
    assert.ok(c.includes('data-vuse="nemotron-3.5-lightning"') && c.includes('data-vrm="nemotron-3.5-lightning"'), 'downloaded: Use this and Remove');
    assert.ok(c.includes('data-vdl="qwen3.8-27b-nvfp4"') && !c.includes('data-vuse="qwen3.8-27b-nvfp4"'), 'not downloaded: Download, no Use this');
    // A download uses vLLM's own tools: no Download before vLLM is installed (review 2026-10-07: it failed, then said
    // "press Download again"); and no Install where nothing can run (a GPU too small, no C compiler).
    assert.ok(!card(render(vllmState({ installed: false, version: null }))).includes('data-vdl='), 'not installed: no Download');
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(upSrc.includes("installable: !!(st && st.gpu && st.curl && st.cc && ['x86_64', 'aarch64'].includes(st.arch) && pr && !pr.gpuTooSmall),"));
    assert.ok(upSrc.includes("if (!vllmProbe.st.installs.some((i) => i.root === target.root)) return { ok: false, error: 'vLLM is not installed on this computer yet: press Install vLLM first.' };"), 'and the farm refuses one');
    assert.equal(V.downloadFailure({ kind: 'noinstall', error: 'x' }, 'a/b'), 'vLLM is not installed on this computer yet: press Install vLLM first.');
    assert.ok(!c.includes('data-vrm="qwen3.6-35b-a3b"') && !c.includes('data-vdl="qwen3.6-35b-a3b"'), 'the one serving cannot be removed');
    assert.ok(c.includes('data-files="21.6"'), 'Remove knows how much it can delete');
    assert.ok(c.includes('Stop vLLM') && !c.includes('Start vLLM'), 'ready: Stop');
    assert.ok(card(render(vllmState({ phase: 'stopped' }))).includes('Start vLLM') && !card(render(vllmState({ phase: 'stopped' }))).includes('Stop vLLM'), 'stopped: Start');
    assert.ok(!/data-vstart|data-vstop/.test(card(render(vllmState({ phase: 'starting' })))), 'starting: neither (the job bar stops it)');
    assert.ok(c.includes('vLLM\'s own log, for when something goes wrong. It does not record conversations, but an error line can quote a few words of a reply.') && c.includes('Show the log'));
    assert.ok(c.includes('the name of a model on Hugging Face (owner/name), made for vLLM. Adding only remembers it: press Download, then Use this.') && c.includes('placeholder="nvidia/Qwen3.6-35B-A3B-NVFP4"'));
    // Not installed yet, on a computer that can run it: the problems, then Install with what it downloads.
    const fresh = vllmPanel({ installed: false, version: null, phase: null, enabled: false,
        probe: { at: 1, oks: ['WSL is installed, with Ubuntu on WSL 2.'], problems: ['vLLM is not installed on this computer yet: press Install vLLM.'], warnings: [] },
        library: vllmPanel().library.map((e) => ({ ...e, downloaded: false, gbOnDisk: null })) });
    const f = card(render(adminState({ vllm: fresh, download: { kind: 'download', label: 'x', done: false, about: 'nope' } })));
    assert.ok(f.includes('<div class="warnline">✗ vLLM is not installed on this computer yet: press Install vLLM.</div>'), 'what blocks it');
    assert.ok(f.includes('data-vinstall disabled'), 'one download at a time');
    assert.equal(card(render(adminState({ vllm: fresh }))), '', 'not open, nothing downloading: no card');
    // The card shows once a download of its own runs, or after the button opened it; here a download runs.
    const withDl = card(render(adminState({ vllm: fresh, download: { kind: 'download', label: 'Downloading Fake', done: false, about: 'qwen3.6-35b-a3b' } })));
    assert.ok(withDl.includes('Downloads vLLM 0.30.0 (about 8 GB) and Qwen3.6 35B-A3B · NVFP4 (23.4 GB) into Ubuntu, in /home/me/lol-spike. About 45 minutes on a typical connection. The farm keeps serving while it downloads; a stopped download keeps the files it finished.'), withDl);
    assert.ok(withDl.includes('<span class="badge">downloading</span>') && !withDl.includes('data-vdl="qwen3.6-35b-a3b"') && !withDl.includes('data-vrm="qwen3.6-35b-a3b"'), 'the row being downloaded');
    // An older vLLM: said, with Update; an install started earlier: said, with Stop it.
    const older = card(render(vllmState({ version: '0.29.0', probe: { at: 1, oks: [], problems: ['A download started earlier is still running. Wait for it, or stop it here.'], warnings: ['vLLM 0.29.0 is installed; this farm was tested with 0.30.0.'] } })));
    assert.ok(/⚠ vLLM 0\.29\.0 is installed; this farm was tested with 0\.30\.0\. <button class="start" data-vinstall[^>]*>Update vLLM<\/button>/.test(older), older);
    assert.ok(/✗ A download started earlier is still running\. Wait for it, or stop it here\. <button class="stop" data-cancel="download"[^>]*>Stop it<\/button>/.test(older));
    // A model of no known family; a folder on disk not in the list.
    const custom = card(render(vllmState({ library: [...vllmPanel().library, { id: 'mistral', label: 'Mistral', repo: 'm/Mistral', args: ['--enable-prefix-caching'], downloaded: false, partial: true, gbOnDisk: 3, active: false, generic: true }], foundFolders: [{ folder: 'old-model', gb: 12 }] })));
    assert.ok(custom.includes('Not one of the measured models: answers work, but tools and thinking may not show until a developer adds its settings.'));
    assert.ok(custom.includes('<span class="badge">partly downloaded</span>') && custom.includes('data-vdl="mistral"'), 'partly downloaded: Download finishes it');
    assert.ok(custom.includes('Also on this computer: old-model (12 GB)') && custom.includes('data-vfolder="old-model"'));
    // Unsupported, and not checked yet.
    assert.ok(card(render(vllmState({ supported: false, probe: null }))).includes('✗ Not available on this computer: vLLM needs an NVIDIA GPU on Linux, or Windows with WSL.'));
    assert.ok(card(render(vllmState({ probe: null }))).includes('Checking this computer…'));
    // The take-over offer (§9.2; the next slice makes the farm fill it).
    const to = render(adminState({ backend: { engine: 'external', alias: 'Qwen3.6', model: 'm', baseUrl: 'http://127.0.0.1:8100/v1', contextLength: 65536, contextPerSlot: 65536, slots: 48 }, externalConfigured: true,
        vllm: vllmPanel({ enabled: false, phase: null, takeOver: { root: '/home/me/lol-spike', running: true } }) }));
    assert.ok(to.includes('<h2>vLLM on this computer</h2>') && to.includes('The vLLM this farm routes to runs on this computer, from /home/me/lol-spike. The farm can run it itself: then you change its model, people and context here, and it starts and stops with the farm. It keeps the same model, name and settings and keeps running: nobody is interrupted.') && to.includes('Let the farm run vLLM'));
    assert.ok(render(adminState({ vllm: vllmPanel({ takeOver: { root: '/r', running: false } }) })).includes('and starts it now: about 2 minutes, during which nobody can chat.'));
    assert.ok(!render(vllmState()).includes('vLLM on this computer'), 'nothing to take over: no card');
    // The panel's requests for these buttons reach routes that exist.
    const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
    const srvSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'selfServer.js'), 'utf8');
    for (const r of ['vllm/check', 'vllm/install', 'vllm/download', 'vllm/library/add', 'vllm/library/remove', 'vllm/stop', 'vllm/start', 'job/cancel', 'vllm/log']) {
        assert.ok(panelSrc.includes(`/lol/admin/${r}`) && srvSrc.includes(`/lol/admin/${r}`), r);
    }
});

test('panel: vLLM\'s rows, its trade line and the Apply text; Apply asks the farm first and confirms only a restart (§7.1, §5.6)', async () => {
    const render = loadPanel();
    const html = render(vllmState());
    const sel = (id) => (new RegExp(`<select id="${id}" data-orig="([^"]*)">([\\s\\S]*?)</select>`).exec(html) || []).slice(1);
    const [slotsOrig, slotsOpts] = sel('slots-sel');
    assert.equal(slotsOrig, 'auto');
    assert.ok(slotsOpts.includes('<option value="auto" selected>Automatic — 48, measured on this card</option>'));
    assert.deepEqual([...slotsOpts.matchAll(/value="(\d+)"/g)].map((m) => Number(m[1])), [1, 2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128]);
    assert.ok(render(vllmState({ seatsAuto: { seats: 10, source: 'memory' } })).includes('Automatic — 10, what the memory holds'));
    assert.ok(render(vllmState({ seatsAuto: { seats: 4, source: 'default' } })).includes('Automatic — 4 to start with'));
    assert.ok(html.includes('people who can write to the model at the same time. They share the GPU, so each reply slows as more write at once; past this number a new message waits for a free seat.'));
    const [ctxOrig, ctxOpts] = sel('ctx-sel');
    assert.equal(ctxOrig, '65536');
    assert.deepEqual([...ctxOpts.matchAll(/value="(\d+)"/g)].map((m) => Number(m[1])), [8192, 16384, 32768, 65536, 131072, 262144]);
    assert.ok(ctxOpts.includes('256k tokens — everything this model can read'));
    assert.ok(html.includes('the longest conversation or document one person can use. A longer context means fewer people fit in the GPU\'s memory.'));
    const [kvOrig, kvOpts] = sel('kv-sel');
    assert.equal(kvOrig, 'auto');
    assert.ok(kvOpts.includes('Automatic — what the GPU has free, less the model, 9 GB for document reading and a safety margin (now 50 GB)'));
    assert.deepEqual([...kvOpts.matchAll(/value="(\d+)"/g)].map((m) => Number(m[1])), [16, 24, 32, 40, 50, 60, 70, 80], 'all below the 95.6 GB card');
    assert.ok(render(vllmState({ unified: true, minFreeGb: 8, cardGib: 119, autoKvGib: 27 })).includes('Automatic — from what the computer has free, less the model, 9 GB for document reading and a safety margin, keeping 8 GB so it cannot run out (now 27 GB)'));
    assert.ok(html.includes('memory vLLM keeps for everyone\'s conversations. Automatic is worked out again at each start.'));
    assert.ok(html.includes('what appears in the model picker. Renaming takes a few seconds; vLLM keeps running.'));
    // The trade line, as configured: vLLM's own count of whole conversations, and what was measured.
    assert.ok(html.includes('Each person gets <b>64k</b> of context. The memory for conversations holds <b>65</b> people at that size. Measured on this card with this model: 48 at 64k when everyone writes at once, ≥ 64 in normal use.'), html.slice(html.indexOf('id="trade"'), html.indexOf('id="trade"') + 500));
    assert.ok(html.includes('Open WebUI reads attached documents whole.'));
    // Edited: worked out from the model's memory per person; a set number past what was measured, or past what fits.
    const edit = (slots, ctx, kv) => {
        render.el('#slots-sel').value = String(slots); render.el('#ctx-sel').value = String(ctx); render.el('#kv-sel').value = String(kv);
        render.el('#ctx-sel').onchange();
        return render.el('#trade').innerHTML;
    };
    const e80 = edit(80, 65536, 'auto');
    assert.ok(e80.includes('After Apply, each person gets <b>64k</b>'), e80);
    assert.ok(e80.includes('The memory for conversations holds <b>67</b> people at that size.'), '50 GiB at 64k, worked out: 67 (§6; vLLM itself said 65.82x)');
    assert.ok(e80.includes('<div class="warnline">More people than measured on this card: when everyone writes at once, replies may slow below a comfortable reading speed.</div>'));
    assert.ok(e80.includes('<div class="warnline">The memory holds only 67 people at 64k: past that, vLLM makes people wait. Lower the people or the context, or give it more memory.</div>'));
    assert.ok(!edit('auto', 131072, 'auto').includes('warnline">More people'), 'Automatic never goes past what was measured');
    assert.ok(edit('auto', 131072, 'auto').includes('Measured on this card with this model: 32 at 128k'), 'another context: its own measurement');
    const e16 = edit(4, 16384, 16);
    assert.ok(e16.includes('<b>16k</b>') && e16.includes('the 8 most relevant passages') && e16.includes('Every connected Open WebUI restarts once'), e16);
    // A card and model nobody measured: said, with the estimator (the owner's question (c)).
    const nm = render(vllmState({ measured: null }));
    assert.ok(nm.includes('Not measured on this card with this model: start with fewer people and watch the Performance card. <a class="plan" href="/lol/capacity" target="_blank" rel="noopener">Plan capacity ↗</a> estimates it.'));
    assert.ok(html.includes('Changes above apply together. A new context, memory or model restarts vLLM: about 2 minutes during which nobody can chat. The name, the password and people at once apply in a few seconds, up to a point for people: many more can restart vLLM too, and Apply asks first when it would.'), 'never "people in a few seconds" alone: 48 → 80 restarts vLLM (review 2026-10-07)');
    assert.ok(render(adminState()).includes('Changes above apply together — one restart for all of them.'), 'Ollama keeps its own');

    // Apply on vLLM: a dry run first; the confirm only when it restarts; nothing sent when the operator says no.
    for (const [restart, answer, sends] of [[true, false, 0], [true, true, 1], [false, false, 1]]) {
        const calls = []; const asked = [];
        const p = loadPanel({
            fetch: async (url, o) => { const body = o && o.body ? JSON.parse(o.body) : null; calls.push([url, body]); return { status: 200, json: async () => (body && body.dryRun ? { ok: true, dryRun: true, restart, changes: ['80 people at once'] } : { ok: true, started: true }) }; },
            confirm: (q) => { asked.push(q); return answer; },
        });
        p(vllmState());
        for (const id of ['#name-in', '#idle-sel', '#ctx-sel', '#kv-sel', '#sec-in']) { p.el(id).value = ''; p.el(id).dataset.orig = ''; }
        p.el('#slots-sel').value = '80'; p.el('#slots-sel').dataset.orig = 'auto';
        await p.el('#settings-apply').onclick();
        await new Promise((r) => setTimeout(r, 10));
        const applies = calls.filter(([u, b]) => u === '/lol/admin/apply' && !b.dryRun);
        assert.deepEqual(calls[0], ['/lol/admin/apply', { slots: 80, dryRun: true }], 'the dry run goes first, with the number');
        assert.deepEqual(asked, restart ? ['Apply now? vLLM restarts: about 2 minutes during which nobody can chat.'] : [], `restart ${restart}`);
        assert.equal(applies.length, sends, `restart ${restart}, answer ${answer}`);
        if (sends) assert.deepEqual(applies[0][1], { slots: 80 });
    }
});

test('panel: the job bar and the download bar, each with Stop when it can stop (§7.3)', () => {
    const render = loadPanel();
    const html = render(vllmState({ phase: 'starting' }, {
        job: { kind: 'engine', label: 'Starting vLLM', message: 'loading the model weights (2 of 3)', percent: 67, done: false, cancellable: true, startedAt: Date.now() - 50000 },
        download: { kind: 'download', label: 'Downloading Nemotron', message: 'downloading Nemotron — 12 of 21.6 GB', percent: 55, bytes: 12e9, total: 21.6e9, bytesPerSec: 30e6, etaSec: 320, done: false, cancellable: true, about: 'nemotron-3.5-lightning', startedAt: Date.now() - 400000 },
    }));
    const bars = html.split('<div class="jobbar').slice(1).map((x) => x.split('<div class="card">')[0]);
    assert.equal(bars.length, 2, 'two bars');
    assert.ok(bars[0].includes('<b>Starting vLLM</b>') && bars[0].includes('loading the model weights (2 of 3) · 67%') && bars[0].includes('data-cancel="job"'), bars[0]);
    assert.ok(bars[0].includes('running for 50s'));
    assert.ok(bars[1].includes('<b>Downloading Nemotron</b>') && bars[1].includes('data-cancel="download"') && bars[1].includes('<b>12.0 GB</b> of 21.6 GB · 30 MB/s · about 5 min left'), bars[1]);
    // A vLLM download's bytes can sit still for minutes and jump (the live test): its bar always shows the time it ran.
    assert.ok(bars[1].includes('about 5 min left · running for 6m'), bars[1]);
    const done = render(vllmState({}, { job: { label: 'Starting vLLM', done: true, ok: false, error: 'Stopped. vLLM is not running: press Start vLLM.', cancellable: false },
        download: { label: 'Downloading Nemotron', done: true, ok: false, error: 'Stopped. Press Download again to go on: the files it finished are kept.', cancellable: false } }));
    assert.ok(done.includes('Stopped. vLLM is not running: press Start vLLM.') && done.includes('Stopped. Press Download again to go on: the files it finished are kept.'));
    assert.ok(!done.includes('data-cancel="job"') && !done.includes('data-cancel="download"'), 'finished: no Stop');
    assert.ok(!render(vllmState({}, { job: { label: 'Applying the farm settings', message: 'x', done: false, cancellable: false } })).includes('data-cancel'), 'a job that cannot stop halfway has no Stop');
    // The page polls every second while either runs.
    assert.ok(/lastState\.download && !lastState\.download\.done/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8')));
});

// D10: no text a person reads names a config file or key — not the panel, not an admin error, not a job result.
const D10_NEEDLES = ['lol.config.json', 'external.', 'binDir', 'enabled=', '.parallel'];
// The string literals of a source's lines that are not comments and not log lines (the terminal and farm.log are
// for whoever runs the farm by hand; the README documents the keys).
function personStrings(src) {
    const out = [];
    src.split('\n').forEach((line, i) => {
        const t = line.trim();
        if (/^(\/\/|\*|\/\*)/.test(t) || /\blog\.(warn|err|info|ok|step|plain)\(|console\.(log|warn|error)\(/.test(line)) return;
        const code = line.replace(/\/\/ .*$/, '').replace(/\$\{[^}]*\}/g, '');
        for (const m of code.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) out.push({ line: i + 1, text: m[1] ?? m[2] ?? m[3] });
    });
    return out;
}
test('D10: no text a person reads names a config file or key — the panel in every engine and vLLM phase, and every admin result in the sources (§11.1-18)', () => {
    const render = loadPanel();
    const states = [
        adminState(), adminState({ llamacppAvailable: false, llamacppBootError: 'Not available on this computer: there is no ready-made llama.cpp for it. The farm serves with Ollama.' }),
        adminState({ backend: { engine: 'llama.cpp', alias: 'a', model: 'm', contextLength: 65536, contextPerSlot: 65536, slots: 1 }, llamacpp: { enabled: true, alias: 'a', library: [], contextLength: 'auto', contextResolved: 65536, parallel: 1 } }),
        adminState({ backend: { engine: 'external', alias: 'a', model: 'm', baseUrl: 'http://127.0.0.1:8100/v1', contextLength: 65536, contextPerSlot: 65536, slots: 48, slotsVerified: false }, externalConfigured: true }),
        ...['ready', 'starting', 'restarting', 'stopping', 'stopped', 'guard', 'down'].map((phase) => vllmState({ phase, adopted: phase === 'ready' })),
        ollamaWithVllm({ phase: 'failed', bootError: 'vLLM could not start: it stopped.' }),
        vllmState({ probe: { at: 1, oks: [], problems: ['vLLM is not installed on this computer yet: press Install vLLM.'], warnings: ['vLLM 0.29.0 is installed; this farm was tested with 0.30.0.'] }, installed: false }),
        vllmState({ supported: false }), vllmState({ takeOver: { root: '/r', running: true } }), vllmState({}, { ocrFits: false, ocrModel: 'qwen3.8:latest', ocrGb: 17 }),
        vllmState({ takenOver: { root: '/r', platform: 'win32', undo: true } }), vllmState({ takenOver: { root: '/r', platform: 'linux', undo: false } }),
    ];
    for (const s of states) {
        const html = render(s);
        for (const n of D10_NEEDLES) assert.ok(!html.includes(n), `the panel shows "${n}" for ${s.backend.engine}/${s.vllm && s.vllm.phase}: …${html.slice(Math.max(0, html.indexOf(n) - 80), html.indexOf(n) + 40)}…`);
    }
    // Every string the farm can hand the panel (an admin error, a job result, a warning) and the panel's own texts.
    const files = ['src/commands/up.js', 'src/perf.js', 'src/llamacpp.js', 'src/vllm.js', 'src/seats.js', 'src/admin/index.html'];
    const hits = [];
    for (const f of files) {
        for (const { line, text } of personStrings(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'))) {
            for (const n of D10_NEEDLES) if (text.includes(n)) hits.push(`${f}:${line} "${text.slice(0, 90)}"`);
        }
    }
    assert.deepEqual(hits, [], `config wording a person would read:\n${hits.join('\n')}`);
});

test('docs: no control character but tab, line feed and carriage return — a Windows path whose backslashes a tool ate turns \\f and \\v into them (review 2026-10-07)', () => {
    const root = path.join(__dirname, '..', '..');
    if (!fs.existsSync(path.join(root, 'docs'))) return;   // a farm-only copy (the Farm app ships farm/ alone)
    const files = fs.readdirSync(path.join(root, 'docs'), { recursive: true }).filter((f) => f.endsWith('.md')).map((f) => path.join('docs', f))
        .concat(['farm/README.md', 'CLAUDE.md']);
    assert.ok(files.includes(path.join('docs', 'PRO6000_VLLM_SWITCH.md')));
    const bad = [];
    for (const f of files) {
        fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((l, i) => { if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(l)) bad.push(`${f}:${i + 1}`); });
    }
    assert.deepEqual(bad, []);
    // The production rollback's path, as PowerShell needs it.
    assert.ok(fs.readFileSync(path.join(root, 'docs', 'PRO6000_VLLM_SWITCH.md'), 'utf8').includes('$cfg = "$env:APPDATA\\LlmOnLan Farm\\farm\\lol.config.json"'));
});

test('admin routes for vLLM: install, the list, the log, the take-over and its Undo, all behind the token, each reaching its control (§3.6)', async () => {
    const http = require('http');
    const seen = [];
    const control = new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : (...a) => { seen.push([k, ...a]); return { ok: true, k }; }) });
    const srv = startSelfServer({ httpPort: 0, host: '127.0.0.1', getSnapshot: () => ({}), control, adminToken: 'tok' });
    await new Promise((r) => srv.once('listening', r));
    const port = srv.address().port;
    const call = (method, p, body, tok = 'tok') => new Promise((resolve) => {
        const data = body ? JSON.stringify(body) : null;
        const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
            let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b) }));
        });
        req.end(data || undefined);
    });
    try {
        for (const [p, body, k, args] of [
            ['/lol/admin/vllm/install', {}, 'vllmInstall', []],
            ['/lol/admin/vllm/library/add', { repo: 'Qwen/Qwen3-0.6B' }, 'vllmLibraryAdd', [{ repo: 'Qwen/Qwen3-0.6B' }]],
            ['/lol/admin/vllm/library/remove', { id: 'x', deleteFiles: true }, 'vllmLibraryRemove', [{ id: 'x', deleteFiles: true }]],
            ['/lol/admin/apply', { model: 'nemotron-3.5-lightning', dryRun: true }, 'applyFarmSettings', [{ model: 'nemotron-3.5-lightning', dryRun: true }]],
            ['/lol/admin/backend', { engine: 'vllm' }, 'setBackend', ['vllm']],
            ['/lol/admin/vllm/take-over', {}, 'vllmTakeOver', []],
            ['/lol/admin/vllm/take-over/undo', {}, 'vllmUndoTakeOver', []],
        ]) {
            assert.equal((await call('POST', p, body, null)).status, 401, `${p} needs the token`);
            seen.length = 0;
            const r = await call('POST', p, body);
            assert.equal(r.status, 200, p);
            assert.deepEqual(seen, [[k, ...args]], p);
        }
        assert.equal((await call('GET', '/lol/admin/vllm/log?lines=50', null, null)).status, 401);
        seen.length = 0;
        assert.equal((await call('GET', '/lol/admin/vllm/log?lines=50')).status, 200);
        assert.deepEqual(seen, [['vllmLog', '50']]);
    } finally { srv.close(); }
});

// ---- "Let the farm run vLLM": the take-over (docs/VLLM_MANAGED_PLAN.md §9) ------------------------------------------
// status.sh as it reads production's operator-run vLLM (pgid 401, ~/lol-spike, :8100), its argv from serve.sh itself.
function prodStatus(over = {}) {
    const root = '/home/ateliernum/lol-spike';
    return {
        home: '/home/ateliernum', root, distro: 'Ubuntu', arch: 'x86_64', gpu: { name: PRO, totalGib: 95.59, freeGib: 20.8, cap: 12 },
        installs: [{ root, version: '0.30.0', link: false }], models: [{ folder: 'Qwen3.6-35B-A3B-NVFP4', gb: 23.4, vision: true, native: 262144, partial: false }],
        running: { pgid: 401, port: 8100, minFreeGb: null, managedArgs: null, argv: serveShArgv(root), ready: true },
        found: [{ root, port: 8100, pgid: 401 }], guardLine: null, installing: null, managed: false, ...over,
    };
}
// A raw lol.config.json as the farm reads it (every default filled in).
const loadConfigFrom = (raw) => ConfigSchema.parse(JSON.parse(JSON.stringify(raw)));
function prodExternalConfig() {
    const c = defaultConfig();
    Object.assign(c.external, PROD_EXTERNAL);
    return c;
}

test('take-over, golden: production\'s operator-run vLLM becomes the farm\'s with the same model, name and settings, kept running, the routing unchanged apart from its key (§9.3, §11.1-7)', () => {
    const plan = V.takeOverPlan(prodExternalConfig(), prodStatus(), 8100, { answering: true });
    assert.ok(plan, 'offered');
    assert.deepEqual({ ...plan, block: undefined }, { root: '/home/ateliernum/lol-spike', distro: 'Ubuntu', port: 8100, running: true, ready: true, pgid: 401, block: undefined, resolved: { kvGib: 50, maxNumSeqs: 128, seats: 48 } });
    assert.deepEqual(plan.block, {
        enabled: true, root: '/home/ateliernum/lol-spike', distro: 'Ubuntu', port: 8100, alias: 'Qwen3.6', model: 'qwen3.6-35b-a3b',
        contextLength: 65536, parallel: 48, kvCacheGib: 50, maxNumSeqs: 'auto', minFreeGb: 'auto', extraArgs: [],
    }, 'no copy of the list: the measured entry is the one it runs');
    // What the farm then runs with (the block in a file, parsed) routes as production's external engine did.
    const managed = loadConfigFrom({ vllm: plan.block });
    assert.equal(toYaml(buildLitellmConfig(managed)).replace('api_key: sk-lol-vllm', 'api_key: sk-lol-external'), toYaml(buildLitellmConfig(prodExternalConfig())));
    assert.deepEqual(V.adoptable(managed, prodStatus().running, { gpuName: PRO }), { ok: true, resolved: { kvGib: 50, maxNumSeqs: 128, seats: 48 }, diff: [] });
    // The DGX Spark's unit: the last value of a repeated flag, its memory guard.
    const unit = fs.readFileSync(path.join(__dirname, '..', 'vllm', 'lol-vllm.service'), 'utf8');
    const extra = /^ExecStart=\S+ \S+serve\.sh (.*)$/m.exec(unit)[1].split(/\s+/);
    const root = '/home/me/lol-vllm';
    const spark = prodStatus({ root, distro: null, gpu: { name: 'NVIDIA GB10', totalGib: null, freeGib: null, cap: 12.1 }, installs: [{ root, version: '0.30.0' }],
        running: { pgid: 7, port: 8100, minFreeGb: 8, argv: [...serveShArgv(root), ...extra], ready: true }, found: [{ root, port: 8100, pgid: 7 }] });
    const sc = prodExternalConfig(); sc.external.parallel = 8;
    const sp = V.takeOverPlan(sc, spark, 8100, { answering: true });
    assert.deepEqual([sp.block.kvCacheGib, sp.block.maxNumSeqs, sp.block.minFreeGb, sp.block.extraArgs, 'distro' in sp.block, sp.resolved.maxNumSeqs], [58, 'auto', 8, [], false, 32]);
});

test('take-over: what it keeps from the server, and when it offers nothing (§9.1, §9.3)', () => {
    const c = prodExternalConfig();
    const withArgs = (more, over = {}) => prodStatus({ running: { ...prodStatus().running, argv: [...prodStatus().running.argv, ...more] }, ...over });
    // A flag the measured entry does not have, or another value for one it has: kept, last.
    let p = V.takeOverPlan(c, withArgs(['--enforce-eager', '--tool-call-parser', 'hermes']), 8100, { answering: true });
    assert.deepEqual(p.block.extraArgs, ['--tool-call-parser', 'hermes', '--enforce-eager']);
    assert.ok(V.adoptable(loadConfigFrom({ vllm: p.block }), withArgs(['--enforce-eager', '--tool-call-parser', 'hermes']).running, { gpuName: PRO }).ok);
    // Another reply limit than the farm's: kept as it runs.
    p = V.takeOverPlan(c, withArgs(['--override-generation-config', '{"max_new_tokens": 8192}']), 8100, { answering: true });
    assert.deepEqual(p.block.extraArgs, ['--override-generation-config', '{"max_new_tokens":8192}']);
    // Another request cap than Automatic gives: a number.
    p = V.takeOverPlan(c, withArgs(['--max-num-seqs', '64']), 8100, { answering: true });
    assert.deepEqual([p.block.maxNumSeqs, p.resolved.maxNumSeqs], [64, 64]);
    // Another presence penalty, and a folder of another name: the entry is copied with them, and a note.
    const cp = prodExternalConfig(); cp.external.presencePenalty = 1.0;
    const st = prodStatus(); st.running.argv[0] = '/home/ateliernum/lol-spike/hf/qwen36'; st.models = [{ folder: 'qwen36', gb: 23, partial: false }];
    p = V.takeOverPlan(cp, st, 8100, { answering: true });
    const e = p.block.library.find((x) => x.id === 'qwen3.6-35b-a3b');
    assert.deepEqual([e.folder, e.presencePenalty, p.block.library.length], ['qwen36', 1.0, 3]);
    assert.match(e.note, /Kept as it ran when the farm took it over\.$/);
    assert.equal(toYaml(buildLitellmConfig(loadConfigFrom({ vllm: p.block }))).replace('api_key: sk-lol-vllm', 'api_key: sk-lol-external'), toYaml(buildLitellmConfig(cp)), 'the same routing');
    // A model the list does not have: a new entry with its family's flags.
    const nst = prodStatus(); nst.running.argv = nst.running.argv.map((a) => (a === 'qwen3.6-35b-a3b' ? 'my-qwen' : a));
    const nc = prodExternalConfig(); nc.external.model = 'my-qwen';
    p = V.takeOverPlan(nc, nst, 8100, { answering: true });
    assert.deepEqual([p.block.model, p.block.library.length, p.block.library[3].id, p.block.library[3].folder, p.block.library[3].vision], ['my-qwen', 4, 'my-qwen', 'Qwen3.6-35B-A3B-NVFP4', true]);
    // Nothing to offer.
    const none = (why, st2, port = 8100, answering = true, cfg = c) => assert.equal(V.takeOverPlan(cfg, st2, port, { answering }), null, why);
    none('no install in that root', prodStatus({ installs: [] }));
    none('a serve.sh on that port from another root', prodStatus({ found: [{ root: '/home/x/other', port: 8100, pgid: 900 }] }));
    none('the server checks a key the farm would not send', withArgs(['--api-key', 'secret']));
    none('a flag the farm adds that the server runs without', prodStatus({ running: { ...prodStatus().running, argv: prodStatus().running.argv.filter((a, i, all) => a !== '--enable-prefix-caching') } }));
    none('a served name that cannot be a model id', prodStatus({ running: { ...prodStatus().running, argv: prodStatus().running.argv.map((a) => (a === 'qwen3.6-35b-a3b' ? 'Qwen 3.6' : a)) } }));
    none('a model outside the root\'s hf folder', prodStatus({ running: { ...prodStatus().running, argv: ['/mnt/models/qwen', ...prodStatus().running.argv.slice(1)] } }));
    none('the external server is on another port than this serve.sh', prodStatus(), 8000, true);
    none('this root runs a server on another port', prodStatus(), 8000, false);
    // Nothing runs: offered when this root has the model, to start it; never when something else answers there.
    const idle = prodStatus({ running: null, found: [] });
    p = V.takeOverPlan(c, idle, 8100, { answering: false });
    assert.equal(p.running, false);
    assert.deepEqual(p.block, { enabled: true, root: '/home/ateliernum/lol-spike', distro: 'Ubuntu', port: 8100, alias: 'Qwen3.6', model: 'qwen3.6-35b-a3b', contextLength: 65536, parallel: 48 },
        'what the farm declared; the rest stays the farm\'s own (Automatic), since nothing runs to keep');
    none('something that is not a serve.sh answers on that port', idle, 8100, true);
    none('the model is not downloaded', prodStatus({ running: null, found: [], models: [{ folder: 'Qwen3.6-35B-A3B-NVFP4', gb: 3, partial: true }] }), 8100, false);
});

test('take-over in the file: a copy first, the vllm block in, the external block out, every other key kept; Undo puts the copy back byte for byte (§9.3, §9.4, §11.1-15)', () => {
    const { takeOverFile, undoTakeOverFile, BACKUP_SUFFIX } = require('../src/configFile');
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'lol-takeover-'));
    try {
        const p = path.join(dir, 'lol.config.json');
        const original = '{\n    "name": "Studio",\n  "proxy": { "port": 4000, "masterKey": "pw" },\n  "external": ' + JSON.stringify(PROD_EXTERNAL) + ',\n  "llamacpp": { "enabled": false, "alias": "x" }\n}\n';
        fs.writeFileSync(p, original);
        const plan = V.takeOverPlan(prodExternalConfig(), prodStatus(), 8100, { answering: true });
        const r = takeOverFile(p, plan.block);
        assert.deepEqual(r, { ok: true, backup: p + BACKUP_SUFFIX, error: null });
        assert.equal(fs.readFileSync(p + BACKUP_SUFFIX, 'utf8'), original, 'the copy is the file as it was');
        const now = JSON.parse(fs.readFileSync(p, 'utf8'));
        assert.deepEqual(Object.keys(now), ['name', 'proxy', 'llamacpp', 'vllm']);
        assert.deepEqual([now.name, now.proxy, now.llamacpp], ['Studio', { port: 4000, masterKey: 'pw' }, { enabled: false, alias: 'x' }]);
        assert.deepEqual(now.vllm, plan.block);
        assert.equal(engineOf(loadConfigFrom(now)), 'vllm', 'the next farm start serves vLLM');
        assert.deepEqual(undoTakeOverFile(p), { ok: true, error: null });
        assert.equal(fs.readFileSync(p, 'utf8'), original, 'byte for byte');
        assert.ok(!fs.existsSync(p + BACKUP_SUFFIX), 'the copy is used up');
        assert.equal(undoTakeOverFile(p).ok, false, 'no copy: nothing to put back');
        assert.equal(fs.readFileSync(p, 'utf8'), original);
        assert.equal(takeOverFile(path.join(dir, 'missing.json'), plan.block).ok, false, 'no file: nothing written');
        // A farm that served llama.cpp before the external server (review 2026-10-07): its llama.cpp left on in the
        // file would start beside vLLM at the next farm start. The take-over writes one engine on, as a switch does.
        const both = original.replace('"enabled": false, "alias": "x"', '"enabled": true, "alias": "x"');
        fs.writeFileSync(p, both);
        assert.equal(takeOverFile(p, plan.block).ok, true);
        const after = JSON.parse(fs.readFileSync(p, 'utf8'));
        assert.deepEqual([after.llamacpp, after.vllm.enabled, 'external' in after], [{ enabled: false, alias: 'x' }, true, false]);
        assert.equal(engineOf(loadConfigFrom(after)), 'vllm');
        assert.equal(undoTakeOverFile(p).ok && fs.readFileSync(p, 'utf8'), both, 'Undo: llama.cpp on again, as it was');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('panel: after the take-over, what changed and Undo while it is possible; the routes exist (§9.2, §9.4, §11.1-18)', () => {
    const render = loadPanel();
    const card = (html) => (/<h2>vLLM on this computer<\/h2>[\s\S]*?(?=<div class="card">)/.exec(html) || [''])[0];
    const win = card(render(vllmState({ adopted: true, takenOver: { root: '/home/ateliernum/lol-spike', platform: 'win32', undo: true } })));
    assert.ok(win.includes('The farm now runs vLLM, from /home/ateliernum/lol-spike: you change its model, people and context here, and it starts and stops with the farm. If this computer started vLLM at log on before, that now only opens the Farm app.'), win);
    assert.ok(win.includes('Undo puts it back as it was: the farm routes to this vLLM without running it, and vLLM keeps running. Possible until a setting changes or the farm restarts.') && /<button data-vundo>Undo<\/button>/.test(win));
    const lin = card(render(vllmState({ takenOver: { root: '/home/me/lol-vllm', platform: 'linux', undo: false } })));
    assert.ok(lin.includes('If a service started it at boot before (lol-vllm), that service starts nothing now: to remove it, run  sudo systemctl disable lol-vllm .'), lin);
    assert.ok(!lin.includes('data-vundo'), 'a setting changed, or vLLM restarted: no Undo');
    assert.ok(render(vllmState({ takenOver: { root: '/r', platform: 'win32', undo: true } }, { job: { label: 'x', done: false } })).includes('data-vundo disabled'), 'not while a job runs');
    const panelSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'admin', 'index.html'), 'utf8');
    const srvSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'selfServer.js'), 'utf8');
    for (const r of ['vllm/take-over', 'vllm/take-over/undo']) assert.ok(panelSrc.includes(`'/lol/admin/${r}'`) && srvSrc.includes(`'/lol/admin/${r}'`), r);
    // The admin state the farm gives: the offer, then what was done.
    const upSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8');
    assert.ok(/takeOver: takeOverOffer \?/.test(upSrc) && /takenOver: takeOverDone \?/.test(upSrc));
});

(async () => {
    for (const { name, fn } of tests) {
        try { await fn(); console.log(`  ok  ${name}`); passed++; }
        catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
    }
    console.log(`\n${passed} passed`);
})();

