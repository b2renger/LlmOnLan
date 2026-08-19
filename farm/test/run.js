// Minimal dependency-free unit tests for the pure pieces of the farm CLI
// (config validation, LiteLLM generation, snapshot, ollama helpers). Run with
// `npm test` in farm/. Network-touching commands are smoke-tested separately.

const assert = require('assert');
const yaml = require('js-yaml');

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
    assert.equal(gemma[0].litellm_params.num_ctx, 65536);
    assert.equal(doc.router_settings.routing_strategy, 'simple-shuffle');
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
    const s = buildSnapshot(c, { proxyUp: true, hostsUp: 1, hostsTotal: 1 });
    assert.equal(s.v, 1);
    assert.ok(s.id && s.id.length >= 8);
    assert.equal(s.proxyPort, 4000);
    assert.equal(s.httpPort, 41997, 'admin/discovery port advertised for the admin page URL');
    assert.ok(s.openaiBaseUrl.endsWith(':4000/v1'));
    assert.equal(s.requiresKey, false);
    assert.equal(s.healthy, true);
    assert.deepEqual(s.models.map((m) => m.id), c.models.map((m) => m.id));
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
    c.modelAlias = 'assistant';
    c.models = [{ id: 'qwen3.6:35b', default: true }];
    assert.deepEqual(buildSnapshot(c, { proxyUp: true, hostsUp: 1 }).models, [{ id: 'assistant', underlying: 'qwen3.6:35b', default: true }]);
    // switch the underlying model → the advertised alias id stays constant (chats
    // don't break), but `underlying` reflects the real model now running.
    c.models = [{ id: 'gemma4:12b', default: true }];
    assert.deepEqual(buildSnapshot(c, { proxyUp: true, hostsUp: 1 }).models, [{ id: 'assistant', underlying: 'gemma4:12b', default: true }]);
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
    // Raised 16384 → 65536 (2026-08-19) after measuring the real KV cost: the served
    // models use sliding-window / grouped attention, so 8k→256k costs only ~1.5 GB.
    assert.equal(defaultConfig().ollama.contextLength, 65536);
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

(async () => {
    for (const { name, fn } of tests) {
        try { await fn(); console.log(`  ok  ${name}`); passed++; }
        catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
    }
    console.log(`\n${passed} passed`);
})();
