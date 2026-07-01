// lol.config.json — the single declarative source of truth for the farm.
//
// Everything the CLI does (which Ollama hosts to use, which models to serve, the
// generated LiteLLM routing, the discovery beacon) is derived from this file.
// Model choice lives HERE (or via `lol models add`) — never hand-edited routing.

const fs = require('fs');
const path = require('path');
const { z } = require('zod');

const CONFIG_FILENAME = 'lol.config.json';

// ---- schema ----------------------------------------------------------------
// Kept permissive where the CLAUDE.md spec is silent, strict where a wrong value
// would silently break the farm (ports, host URLs).

const ModelSchema = z.object({
    id: z.string().min(1),              // ollama tag clients request, e.g. "gemma4:12b"
    default: z.boolean().optional(),    // marks the catalog default (informational)
    // Force image support on/off. Omit to auto-infer from the tag (gemma4, llava,
    // *-vl, *-vision, …). Drives `supports_vision` in the generated LiteLLM config
    // so the proxy passes images through instead of dropping them.
    vision: z.boolean().optional(),
}).strict();

const BeaconSchema = z.object({
    enabled: z.boolean().default(true),
    group: z.string().default('239.255.43.10'),   // distinct from ComfyQ's 239.255.42.99
    port: z.number().int().positive().default(41998),
    intervalSec: z.number().positive().default(5),
    // Unicast HTTP self-endpoint (GET /lol/self) for subnet sweeps / manual-add on
    // LANs that block broadcast+multicast. Mirrors ComfyQ's /federation/self.
    httpPort: z.number().int().positive().default(41997),
}).strict();

const ProxySchema = z.object({
    port: z.number().int().positive().default(4000),
    host: z.string().default('0.0.0.0'),           // bind on all ifaces so LAN clients reach it
    // Optional shared secret. If set, clients (and OWUI) must send it as the API key.
    // null/absent => open proxy for a trusted LAN (simplest for a workshop).
    masterKey: z.string().nullable().optional(),
}).strict();

const OllamaSchema = z.object({
    hosts: z.array(z.string().url()).min(1).default(['http://127.0.0.1:11434']),
    numParallel: z.number().int().positive().default(2),    // OLLAMA_NUM_PARALLEL
    maxLoadedModels: z.number().int().positive().default(1),// OLLAMA_MAX_LOADED_MODELS
    flashAttention: z.boolean().default(true),              // OLLAMA_FLASH_ATTENTION
}).strict();

const LiteLLMSchema = z.object({
    // How to invoke LiteLLM. Default assumes `litellm` is on PATH; operators who
    // installed it into a venv point this at that venv's litellm[.exe].
    command: z.string().default('litellm'),
    extraArgs: z.array(z.string()).default([]),
    // model prefix: ollama_chat (chat-templated, recommended) | ollama (raw)
    provider: z.enum(['ollama_chat', 'ollama']).default('ollama_chat'),
}).strict();

const ConfigSchema = z.object({
    name: z.string().default('LlmOnLan Farm'),
    beacon: BeaconSchema.default({}),
    proxy: ProxySchema.default({}),
    models: z.array(ModelSchema).min(1).default([{ id: 'gemma4:12b', default: true }]),
    ollama: OllamaSchema.default({}),
    litellm: LiteLLMSchema.default({}),
    // Coordinator mode: aggregate LAN peer farms into one balanced endpoint that
    // clients prefer. Also settable per-run via `lol up --coordinator`.
    coordinator: z.boolean().default(false),
}).strict();

// ---- defaults --------------------------------------------------------------

function defaultConfig() {
    // Parse {} through the schema so every default is materialized exactly once.
    return ConfigSchema.parse({});
}

// ---- io --------------------------------------------------------------------

// Search order for the config: an explicit path, then $CWD, then the farm dir.
function resolveConfigPath(explicit) {
    if (explicit) return path.resolve(explicit);
    const cwd = path.join(process.cwd(), CONFIG_FILENAME);
    if (fs.existsSync(cwd)) return cwd;
    const farmDir = path.join(__dirname, '..', CONFIG_FILENAME);
    if (fs.existsSync(farmDir)) return farmDir;
    return cwd; // canonical location for `lol init` to create
}

function configExists(explicit) {
    return fs.existsSync(resolveConfigPath(explicit));
}

// Load + validate. Throws a friendly Error if missing or invalid.
function loadConfig(explicit) {
    const p = resolveConfigPath(explicit);
    if (!fs.existsSync(p)) {
        const err = new Error(`No ${CONFIG_FILENAME} found (looked at ${p}). Run \`lol init\` to scaffold one.`);
        err.code = 'NO_CONFIG';
        throw err;
    }
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) {
        const err = new Error(`${CONFIG_FILENAME} is not valid JSON: ${e.message}`);
        err.code = 'BAD_JSON';
        throw err;
    }
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) {
        const issues = parsed.error.issues.map(i => `  • ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
        const err = new Error(`${CONFIG_FILENAME} failed validation:\n${issues}`);
        err.code = 'BAD_CONFIG';
        throw err;
    }
    return { config: parsed.data, path: p };
}

function writeConfig(p, config) {
    fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

module.exports = {
    CONFIG_FILENAME,
    ConfigSchema,
    defaultConfig,
    resolveConfigPath,
    configExists,
    loadConfig,
    writeConfig,
};
