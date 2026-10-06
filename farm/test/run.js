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
function loadPanel() {
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
    const document = { querySelector: el, activeElement: null };
    const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    // eslint-disable-next-line no-new-func
    const fn = new Function('document', 'localStorage', 'setInterval', 'fetch', 'confirm',
        `${m[1]}\n;return { render };`);
    const out = fn(document, localStorage, () => 0, () => new Promise(() => {}), () => false);
    const render = (state) => { out.render(state); return el('#app').innerHTML; };
    render.el = el;   // the stubs, for a test that edits a control after render
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
        const plan = carryNameAcross(c, toLc);
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
    assert.deepEqual(carryNameAcross(c, false), {}, 'skip rather than merge two models into one name');
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
    const rt = { pluginKey: (id) => pluginKey(id, file), resolveOcrModel: () => 'gemma4:12b', isLocalHost: () => true, reachable: ['http://127.0.0.1:11434'] };
    const start = () => Object.fromEntries(makeServices().filter((s) => ['ocr', 'classify', 'stt'].includes(s.id))
        .map((s) => [s.id, s.desc.makeCtx(defaultConfig(), rt).key]));
    try {
        const first = start();
        const second = start();   // the next `lol up`: a new process reads the same file
        assert.deepEqual(second, first, 'the same key for each plugin across starts');
        assert.equal(new Set(Object.values(first)).size, 3, 'one key per plugin');
        for (const k of Object.values(first)) assert.match(k, /^[0-9a-f]{48}$/);
        const keyed = defaultConfig(); keyed.proxy.masterKey = 'pw';
        const keyId = (k) => buildSnapshot(keyed, { proxyUp: true, hostsUp: 1, extractUp: true, extractKey: k }).extract.keyId;
        assert.equal(keyId(second.ocr), keyId(first.ocr), 'keyId stays put, so clients do not refetch');
        fs.unlinkSync(file);
        assert.notEqual(start().ocr, first.ocr, 'deleting the secret rotates the keys');
    } finally { try { fs.unlinkSync(file); } catch { /* gone */ } }
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
    assert.ok(/can't all hold their full window at once/.test(w) && /\(4 can\)/.test(w) && /262,144/.test(w), w);
    assert.equal(perfMod.poolShortfall(4, 32768, 131072), null, 'an exact fit is a fit');
    assert.ok(/not even one can/.test(perfMod.poolShortfall(1, 32768, 16000)));
    assert.equal(perfMod.poolShortfall(8, 32768, null), null, 'unknown pool → no warning');
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
            'Context cache hits <b>75%</b>', 'Draft tokens accepted <b>70%</b>', 'can&#39;t all hold their full window at once']) {
            assert.ok(html.includes(needle) || html.includes(needle.replace('&#39;', "'")), `card lost: ${needle}`);
        }
        assert.ok(!html.includes('nearly full while idle'), 'no llama.cpp VRAM warning on a vLLM');
        assert.ok(!html.includes('Capacity is unverified'), 'the Ollama env advice never shows for an external server');
        assert.ok(/poolWarning: config\.external\.enabled/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'commands', 'up.js'), 'utf8')), 'the admin state carries the warning');

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
    assert.deepEqual([...new Set(all.map((e) => e.snap.backend.engine))].sort(), ['external', 'llama.cpp', 'ollama']);
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
    assert.deepEqual(schemaErrors(SNAPSHOT_SCHEMA, { ...snap, backend: { ...snap.backend, engine: 'vllm' } }), ['$.backend.engine: "vllm" is not one of ollama, llama.cpp, external']);
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
    assert.ok(ext.includes('Each person gets <b>64k</b> of context, as declared in lol.config.json (external.contextLength).'));
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

(async () => {
    for (const { name, fn } of tests) {
        try { await fn(); console.log(`  ok  ${name}`); passed++; }
        catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
    }
    console.log(`\n${passed} passed`);
})();

