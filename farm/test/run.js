// Minimal dependency-free unit tests for the pure pieces of the farm CLI
// (config validation, LiteLLM generation, snapshot, ollama helpers). Run with
// `npm test` in farm/. Network-touching commands are smoke-tested separately.

const assert = require('assert');
const yaml = require('js-yaml');

let passed = 0;
const test = (name, fn) => {
    try { fn(); console.log(`  ok  ${name}`); passed++; }
    catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

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
const { buildLitellmConfig, toYaml } = require('../src/litellm');

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

// ---- snapshot --------------------------------------------------------------
const { buildSnapshot } = require('../src/snapshot');

test('snapshot carries the discovery contract', () => {
    const c = defaultConfig();
    const s = buildSnapshot(c, { proxyUp: true, hostsUp: 1, hostsTotal: 1 });
    assert.equal(s.v, 1);
    assert.ok(s.id && s.id.length >= 8);
    assert.equal(s.proxyPort, 4000);
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

// ---- net -------------------------------------------------------------------
const { broadcastAddr } = require('../src/net');

test('broadcastAddr honors the netmask (/23 → .17.255)', () => {
    assert.equal(broadcastAddr('10.10.16.58', '255.255.254.0'), '10.10.17.255');
    assert.equal(broadcastAddr('192.168.1.20', '255.255.255.0'), '192.168.1.255');
});

console.log(`\n${passed} passed`);
