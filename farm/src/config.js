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
    // Per-model stable alias — the id clients see for THIS model (a role name like
    // "coder"). Chats bind to the alias, so the underlying model can be swapped
    // without breaking them. The global `modelAlias` covers the default model.
    alias: z.string().optional(),
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
    // OLLAMA_KEEP_ALIVE — how long a model stays in VRAM after its last request.
    // Ollama's own default (5m) means the first student after a pause eats a full
    // model reload (~30–60s on a 35B). '-1' = keep loaded forever — the right call
    // for a dedicated GPU box. Only applies to an Ollama that `lol` starts.
    keepAlive: z.string().default('-1'),
    // OLLAMA_CONTEXT_LENGTH — the default context window (num_ctx) for served
    // models. Ollama's own default (4096 tokens) silently TRUNCATES longer
    // prompts — with the client's whole-document mode a 6-page PDF already
    // overflows it, which looks like "the model ignored half my document"
    // (rig-verified). 16384 fits workshop docs; lower it on small-VRAM GPUs
    // (KV cache grows with context × numParallel). Only applies to an Ollama
    // that `lol` starts — set it on the service otherwise (the CLI prints it).
    contextLength: z.number().int().positive().default(16384),
}).strict();

const WebsearchSchema = z.object({
    // One shared SearXNG metasearch instance on this box; clients discover it via
    // the beacon (snapshot.searxngUrl) and OWUI uses it for per-message web search.
    // `lol up` installs it on first run (source tarball + its own venv under
    // .searxng/). ON BY DEFAULT — a fresh farm gets web search automatically (set
    // enabled:false to opt out). The install is small; failure is non-fatal.
    enabled: z.boolean().default(true),
    port: z.number().int().positive().default(8888),
}).strict();

const TtsSchema = z.object({
    // One shared Kokoro-82M neural TTS on this box; clients discover it via the
    // beacon (snapshot.ttsUrl) and OWUI uses it for read-aloud / voice output.
    // `lol up` installs it on first run (own venv + GPU-agnostic torch under
    // .kokoro/). Heavy install (multi-GB torch) — off by default.
    enabled: z.boolean().default(false),
    port: z.number().int().positive().default(8880),   // Kokoro-FastAPI default
    voice: z.string().default('af_heart'),             // OWUI AUDIO_TTS_VOICE
    model: z.string().default('kokoro'),               // OWUI AUDIO_TTS_MODEL
}).strict();

const OcrSchema = z.object({
    // One shared "lol-extract" document-extraction service on this box; clients
    // discover it via the beacon (snapshot.extract) and OWUI uses it as its
    // CONTENT_EXTRACTION_ENGINE=external loader — so every uploaded image / scanned
    // PDF is OCR'd (RAG-searchable AND transcribable) with zero client setup. `lol
    // up` installs it on first run (own venv under .extract/). OFF by default (it
    // reroutes ALL of OWUI's document ingestion through the farm; opt in per box).
    enabled: z.boolean().default(false),
    port: z.number().int().positive().default(8890),
    // Vision model Ollama-OCR drives (a real Ollama tag, e.g. gemma4:12b). Omit to
    // auto-use the farm's served default vision model (see resolveOcrModel in up.js).
    model: z.string().optional(),
    // Ollama-OCR output format for the vision path.
    format: z.enum(['markdown', 'text', 'json', 'structured', 'key_value', 'table']).default('markdown'),
    // PDF handling: auto = text layer when present, else vision-OCR the page image;
    // vision = always OCR every page; text = never OCR (embedded text only).
    pdfEngine: z.enum(['auto', 'vision', 'text']).default('auto'),
    // Ollama-OCR's cv2 binarization. Off by default — a raw image usually reads
    // better on a vision LLM than a harshly thresholded one.
    preprocess: z.boolean().default(false),
    // Route non-image docs through Docling for richer office/table fidelity. Heavy
    // install (torch + models, multi-GB), so off by default — the light extractors
    // (PyMuPDF/python-docx) cover pdf/docx/text without it.
    docling: z.boolean().default(false),
}).strict();

const AdminSchema = z.object({
    // Shared secret for the live control API (start/stop models, toggle plugins) that
    // the farm-served admin page at http://<box>:<httpPort>/lol/admin uses. null → `lol
    // up` generates an ephemeral token each run and prints it (paste it into the page).
    // Read-only GET /lol/self + the admin page HTML stay open; only /lol/admin/state +
    // the POST control routes require `Authorization: Bearer <token>`.
    token: z.string().nullable().default(null),
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
    websearch: WebsearchSchema.default({}),
    tts: TtsSchema.default({}),
    ocr: OcrSchema.default({}),
    admin: AdminSchema.default({}),
    // Coordinator mode: aggregate LAN peer farms into one balanced endpoint that
    // clients prefer. Also settable per-run via `lol up --coordinator`.
    coordinator: z.boolean().default(false),
    // Stable model alias: expose ONE fixed model id to clients regardless of which
    // Ollama model is served behind it. Switching the served model (via the picker)
    // then never breaks an existing OWUI chat, which is pinned to the model id.
    // null/empty = off (clients see the real model names). Settable per-run via
    // `lol up --alias <name>`. The alias is backed by the DEFAULT picked model.
    modelAlias: z.string().nullable().default(null),
    // Client-side plugins (e.g. "blender") the farm RECOMMENDS to connected clients —
    // the farm can't run a per-client plugin, only advertise it; each client auto-applies
    // what it can. Set live via the admin panel (control.recommendClientPlugin).
    recommendedClientPlugins: z.array(z.string()).default([]),
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
