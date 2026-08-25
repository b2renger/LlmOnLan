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
    // Upstream tag to pull and derive `id` from, e.g. a Hugging Face GGUF:
    //   "hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ2_XXS"
    // When set, `lol up` pulls THIS and then creates `id` from it with `params`
    // applied. Omit for a plain library model, where `id` is pulled directly.
    source: z.string().optional(),
    // Ollama Modelfile PARAMETERs baked into the derived model. Only meaningful
    // with `source`. This is how an HF-pulled quant gets the launch parameters an
    // Ollama library model ships with — above all `draft_num_predict`, which turns
    // on Qwen3.8's built-in MTP head and is worth ~1.8x throughput. A bare hf.co
    // pull has none of them, which is a silent halving of speed.
    params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    // HTTPS URL of a separate DRAFT (speculative-decoding) module to attach.
    //
    // Needed because Unsloth strips the built-in MTP head from every quant under
    // UD-Q2_K_XL to save ~500 MB, and ships it as a standalone file instead. Without
    // it a small quant silently gets NO speculative decoding: `draft_num_predict`
    // is accepted and ignored, because there are no `nextn` tensors to drive.
    //
    // Downloaded to farm/.models/ (an ollama `hf.co/...` pull cannot address a file
    // inside a repo SUBFOLDER, which is where the module lives), then wired in via the
    // Modelfile `DRAFT` instruction. LOCAL HOSTS ONLY: Ollama's REST /api/create
    // silently drops a `draft` field — verified on 0.32.15, it returns success and no
    // DRAFT line appears — and the DRAFT instruction resolves its argument as a file
    // path on the machine running ollama. So this is applied via the CLI.
    draft: z.string().url().optional(),
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
    // (rig-verified).
    //
    // 16384 (LOWERED from 65536, 2026-08-21). The previous default was measured on
    // a 96 GB RTX PRO 6000 and does not survive on the 12 GB cards this farm
    // actually runs on. MEASURED on an RTX 4070 Ti (12 GB) serving
    // Qwen3.8-27B UD-IQ2_XXS, whole KV preallocated at load:
    //     ctx  8192 ->  9.18 GB peak, 100% GPU, 51.8 tok/s
    //     ctx 16384 ->  9.68 GB peak, 100% GPU, 51.5 tok/s   <-- this default
    //     ctx 32768 -> 10.70 GB peak, 100% GPU, 51.4 tok/s   (zero margin)
    //     ctx 65536 -> SPILLED to CPU, ~10 tok/s             (5x slower)
    // The usable ceiling on a 12 GB card is ~10.7 GB, so 32768 fits with NO room
    // for the desktop — one browser window tips it into offload. 16384 keeps ~1 GB
    // of margin at identical throughput, because context is nearly free in speed
    // terms and costs only VRAM.
    //
    // IMPORTANT: raise this on a big-VRAM box (admin panel = live, this field =
    // persistent). It is farm-GLOBAL but VRAM is per-host, so a mixed fleet is
    // currently served by whichever single value is set here — on a 96 GB box the
    // model's native 262144 maximum is reachable and this default wastes it.
    // Only applies to an Ollama that `lol` starts — but num_ctx also rides the
    // generated LiteLLM routing, which applies on EVERY host regardless of who
    // started it, and is what actually decides whether a client request spills.
    contextLength: z.number().int().positive().default(16384),
}).strict();

// llama.cpp (`llama-server`) as an ALTERNATIVE backend to Ollama, opt-in per farm.
//
// The reason it exists is speculative decoding on a 12 GB card. Measured on the
// fleet's hardware, no Ollama configuration gets both MTP and a resident model:
//   UD-IQ2_XXS            ~9.9 GB, fits — but its MTP head is STRIPPED by Unsloth
//   UD-IQ2_XXS + module  ~11.0 GB, spills
//   UD-Q2_K_XL (Ollama)   ~11   GB, spills — KV quantization does not engage
//   UD-Q2_K_XL (llama.cpp, q4_0 KV, MTP)  ~10.6 GB, FITS — 154.8 tok/s, 0.13s TTFT
//
// When enabled, `lol up` runs llama-server INSTEAD of routing that model through
// Ollama, and LiteLLM fronts it as an OpenAI deployment — so the client is
// unchanged and cannot tell which backend answered.
const LlamacppSchema = z.object({
    enabled: z.boolean().default(false),
    host: z.string().default('127.0.0.1'),   // LiteLLM is the only thing that talks to it
    port: z.number().int().positive().default(8081),
    // The served name clients request. Matches `modelAlias` so swapping backends does
    // not break chats bound to the alias.
    alias: z.string().default('assistant'),
    // https URL of the .gguf to serve. MUST be a quant that still carries its MTP head
    // (UD-Q2_K_XL and above) if `mtp` is on — llama-server refuses to start otherwise,
    // with "model doesn't contain MTP layers".
    model: z.string().url().nullable().default(
        'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/Qwen3.8-27B-UD-Q2_K_XL.gguf'
    ),
    // Vision projector. Qwen3.8 is multimodal; without this it is text-only.
    mmproj: z.string().url().nullable().default(
        'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/mmproj-F16.gguf'
    ),
    contextLength: z.number().int().positive().default(16384),
    ngl: z.number().int().default(999),          // offload everything; partial = the cliff
    parallel: z.number().int().positive().default(1),
    flashAttention: z.boolean().default(true),   // required for KV quantization
    // q4_0 KV is what makes an MTP-capable quant fit in 12 GB. 'f16' disables it.
    kvCacheType: z.enum(['q4_0', 'q8_0', 'f16']).default('q4_0'),
    mtp: z.boolean().default(true),              // --spec-type draft-mtp
    draftNMax: z.number().int().positive().default(2),
    // Point at an existing llama.cpp install instead of the bootstrapped one. Required
    // on platforms with no prebuilt asset (anything but win-x64 today).
    binDir: z.string().nullable().default(null),
    extraArgs: z.array(z.string()).default([]),
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
    // up` installs it on first run (own venv under .extract/, torch-free). ON by
    // default (owner call 2026-07-05 after rig testing — document upload is a core
    // workshop flow); it reroutes ALL of OWUI's document ingestion through the
    // farm, so set enabled:false to opt a box out.
    enabled: z.boolean().default(true),
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
    // What this farm SERVES. Everything here becomes a LiteLLM deployment and is
    // advertised to clients, so a client CAN select it — and on a single-GPU box
    // selecting a second model evicts the first. That makes this list a farm-admin
    // decision and never a client one: whatever is listed here, any client can cause
    // to load. Keep it to ONE model unless the box genuinely has VRAM for more.
    //
    // The admin panel mutates this at runtime (startModel/stopModel regenerate the
    // routing and warm/evict), which is the supported way to change what runs. For
    // models kept ready but deliberately NOT served, see `preinstall` below.
    models: z.array(ModelSchema).min(1).default([
        { id: 'gemma4:12b', default: true },
    ]),

    // Models to DOWNLOAD but NOT serve. `lol install` and `lol up` pull and derive
    // these exactly like served ones, so they sit on disk ready to start — but they
    // get no LiteLLM deployment and are absent from the discovery snapshot, so no
    // client can see or select one, and therefore no client can trigger a model swap
    // on the farm. Starting one is the farm admin's call, from the admin panel (which
    // lists everything installed on the host); startModel picks the full definition up
    // from here, so alias/vision/params survive rather than degrading to a bare id.
    //
    // The default entry is the measured pick for the 12 GB cards this farm targets
    // (method and data in farm/bench/, on the bench/quant-ladder branch): Qwen3.8-27B
    // at Unsloth UD-IQ2_XXS — 51.5 tok/s fully GPU-resident on a 4070 Ti and 90% on
    // the graded quality suite pooled over 126 attempts, statistically tied with the
    // larger UD-IQ2_S (91%) while ~10% faster and 1.1 GB smaller.
    //
    // Do NOT "optimise" it downward: the smaller quants measured FASTER but much worse
    // (UD-IQ1_M 81%, computes 47*83 as 3941; UD-IQ1_S 63%, loses code generation
    // entirely) — the fastest quant is the most damaged one. Bigger fails differently:
    // UD-Q2_K_XL needs 11 GB, spills to CPU, and costs 6.4x. On a big-VRAM box swap in
    // a higher quant and raise ollama.contextLength.
    //
    // NOTE on a 12 GB card this and gemma4:12b cannot be co-resident (8.6 + 7.6 GB),
    // so starting it from the panel means stopping gemma — deliberately the admin's
    // decision, not a side effect of someone's model picker.
    preinstall: z.array(ModelSchema).default([
        {
            id: 'qwen3.8-27b-iq2xxs',
            source: 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ2_XXS',
            // UD-IQ2_XXS is 7.27 GB — below Unsloth's UD-Q2_K_XL cutoff, so its MTP
            // head is STRIPPED (verified: 0 `nextn` tensors, vs 4 in Q2_K_XL/IQ3_XXS
            // /the ollama library build). `draft_num_predict` alone is therefore inert
            // here; the separate module below is what actually makes it do anything.
            draft: 'https://huggingface.co/unsloth/Qwen3.8-27B-GGUF/resolve/main/MTP/mtp-Qwen3.8-27B-Q4_0.gguf',
            // MEASURED on an RTX PRO 6000, total GPU memory less the ~1.6 GB desktop:
            //     IQ2_XXS alone,        ctx 16384 :  ~9.9 GB
            //     IQ2_XXS + draft,      ctx  8192 : ~11.0 GB
            //     IQ2_XXS + draft,      ctx 16384 : ~11.3 GB
            // The module is 1.3 GB on disk (not the ~500 MB the docs suggest), which
            // gives back almost the entire 1.5 GB that IQ2_XXS saved over UD-Q2_K_XL.
            // A 4070-class card tops out around 10.7 GB, so this is EXPECTED TO SPILL
            // there — num_ctx is pinned to 8192 to give it the best chance. Verify with
            // `ollama ps`: anything other than "100% GPU" means it did not fit, and the
            // MTP-capable UD-Q2_K_XL via a llama.cpp backend (quantized KV, ~10.6 GB)
            // is the configuration that does.
            params: { draft_num_predict: 4, num_ctx: 8192 },
            vision: true,                        // multimodal; tag alone does not reveal it
            // Stable role name so a chat bound to it survives a quant change. Without
            // this, clients bind to "qwen3.8-27b-iq2xxs" and re-quantising breaks them.
            alias: 'reasoning',
        },
    ]),
    ollama: OllamaSchema.default({}),
    llamacpp: LlamacppSchema.default({}),
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
