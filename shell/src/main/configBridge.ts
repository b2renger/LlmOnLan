// config-bridge — the ONLY module that knows Open WebUI's config surface.
//
// Per the integration contract (CLAUDE.md) + the research brief, we couple to
// OWUI exclusively through env vars (+ optionally the admin REST API). The chosen
// strategy is ENV-AUTHORITATIVE:
//
//   OWUI's OPENAI_* are "PersistentConfig" — env seeds only the FIRST boot, then
//   the SQLite DB wins, so a single admin-UI edit could pin a stale farm URL
//   forever (DHCP moves the IP). We set ENABLE_PERSISTENT_CONFIG=false so env is
//   authoritative on EVERY launch: repointing the farm == restart the sidecar
//   with a new OPENAI_API_BASE_URL, with no OWUI edits and no stale URL winning.
//
// This is invariant #4 ("touch OWUI only through its public surface") and the
// M1 acceptance criterion. The admin REST path (POST /openai/config/update) is a
// documented alternative but is session-only while persistent config is off, so
// we don't use it.

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';

// Stable WEBUI_SECRET_KEY (signs JWTs / encrypts at rest). Generated once and
// persisted so OWUI sessions survive restarts. OWUI would auto-generate one in
// CWD otherwise; we own it explicitly + keep it out of CWD.
export function getSecretKey(): string {
    const file = path.join(app.getPath('userData'), '.webui-secret-key');
    try {
        const v = fs.readFileSync(file, 'utf8').trim();
        if (v) return v;
    } catch { /* create below */ }
    const key = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(file, key, 'utf8'); } catch { /* non-fatal; ephemeral key */ }
    return key;
}

export interface SidecarEnvInput {
    endpoint: string | null;   // the farm OpenAI base URL, e.g. http://10.0.0.5:4000/v1
    dataDir: string;
    apiKey?: string | null;    // farm master key, or null for an open LAN proxy
    defaultModel?: string | null; // the farm's advertised default model → OWUI DEFAULT_MODELS
    searxngUrl?: string | null;   // the farm's shared SearXNG → OWUI web search
    tts?: { url: string; voice: string; model: string } | null; // farm Kokoro → OWUI AUDIO_TTS_*
    extract?: { url: string; key: string } | null; // farm lol-extract → OWUI external document loader (OCR)
    contextPerSlot?: number | null; // farm's per-slot context window (snapshot backend.contextPerSlot) → RAG mode
}

// Whole-document RAG needs the whole document to FIT. Below this per-slot context
// the farm can't hold a typical attachment + the answer, so injecting full text
// turns "attach a webpage" into a hard ContextWindowExceededError (llama.cpp) or a
// silently beheaded prompt (Ollama keeps the tail, drops the system prompt).
// 24k ≈ a 60-80 KB document with room to answer — matrix-verified on the 16k farm,
// where a 41k-token attachment errored in full mode and answered in retrieval mode.
export const FULL_CONTEXT_MIN_CTX = 24576;

// Build the environment Open WebUI is launched with. This is the whole coupling.
export function buildSidecarEnv(input: SidecarEnvInput): Record<string, string> {
    // Adaptive retrieval mode: whole-document injection on farms with room for it,
    // classic top-k retrieval on small-context farms (16k default fleets). An old
    // farm that doesn't advertise backend.contextPerSlot keeps the historic
    // whole-document behavior.
    const fullContext = input.contextPerSlot == null || input.contextPerSlot >= FULL_CONTEXT_MIN_CTX;
    const env: Record<string, string> = {
        // --- data locality (invariant #3): everything lives under DATA_DIR ---
        DATA_DIR: input.dataDir,
        WEBUI_SECRET_KEY: getSecretKey(),

        // --- kiosk / single-user: no login ceremony (data is already per-user + local) ---
        WEBUI_AUTH: 'false',

        // --- env is authoritative every launch (no stale persisted farm URL) ---
        ENABLE_PERSISTENT_CONFIG: 'false',

        // --- OWUI version updates are OUR job, not OWUI's ---
        // We pin + repackage OWUI as a sidecar tarball and ship updates through the
        // app's own "Check for chat-engine update" (sidecarManager). OWUI's built-in
        // upstream check would pop a "new version available" toast for releases we
        // haven't packaged yet — which directly contradicts our up-to-date button and
        // confused users. Turn it off so the app is the single source of truth.
        ENABLE_VERSION_UPDATE_CHECK: 'false',

        // --- connection: talk ONLY to the farm's OpenAI-compatible endpoint ---
        // ENABLE_OPENAI_API is set below — true only when we have a farm endpoint,
        // so a no-farm boot can't fall back to OWUI's default api.openai.com.
        ENABLE_OLLAMA_API: 'false',   // never hit Ollama directly; the farm fronts it

        // --- privacy: documents embed LOCALLY (default MiniLM); never to the farm ---
        // RAG_EMBEDDING_ENGINE is deliberately UNSET → in-process SentenceTransformers.
        // (Setting it to "ollama"/"openai" would ship document text off-device.)

        // --- documents: answer from the WHOLE document, not top-k chunks ---
        // OWUI's default retrieval sends only the RAG_TOP_K (3!) best-matching
        // chunks to the model, so whole-document asks ("list ALL items in this
        // invoice") deterministically miss content that doesn't match the query —
        // rig-verified: a 6-page invoice answered from 3 chunks listed 4 of 9
        // products. Workshop docs are small and whole-doc questions dominate, so
        // full-context mode (inject the entire extracted text, skip retrieval) is
        // the right default here. Trade-off: a LARGE attached knowledge collection
        // is injected whole too — revisit if workshops grow big knowledge bases.
        // Needs a model context that fits a document — which is exactly what the
        // farm's advertised contextPerSlot tells us, hence the adaptive gate above.
        RAG_FULL_CONTEXT: fullContext ? 'true' : 'false',
        // Only read in retrieval mode (full-context ignores k). OWUI's default of 3
        // chunks was the original "listed 4 of 9 products" bug; 8 chunks ≈ 2-3k
        // tokens — comfortably inside even a 8k slot, and much better recall.
        RAG_TOP_K: '8',

        // --- attach webpage must work on a LAN-first product ---
        // OWUI's web loader refuses URLs that resolve to private addresses (SSRF
        // guard for hosted multi-user deployments — matrix-verified: attaching any
        // intranet page fails with a generic "Error querying knowledge base"). This
        // app IS the LAN: the farm, the wiki, the dashboards people want to attach
        // all live on private IPs, the app is single-user, and OWUI only ever binds
        // 127.0.0.1. Allow local fetches.
        ENABLE_LOCAL_WEB_FETCH: 'true',

        // --- attached files must not cost a hidden second completion ---
        // With files attached, OWUI first asks the model to write retrieval queries
        // (ENABLE_RETRIEVAL_QUERY_GENERATION, default ON) — a full extra LLM call
        // on the farm's inference slot BEFORE the real answer (matrix-verified: 13
        // farm completions for 7 chats). In full-context mode the generated queries
        // are never used; in retrieval mode OWUI falls back to embedding the user's
        // message itself, which is the standard RAG pattern anyway. Same class of
        // fix as the follow-up/tags trio below. (ENABLE_SEARCH_QUERY_GENERATION is
        // a separate flag and stays ON — web search genuinely needs it.)
        ENABLE_RETRIEVAL_QUERY_GENERATION: 'false',

        // --- default model capabilities (vision, + web_search when the farm has it) ---
        // Over an OpenAI-style connection OWUI can't discover a model's capabilities
        // (the farm's /v1/models lists names only), so it defaults vision OFF — and a
        // vision-off model means OWUI neither sends attached images inline NOR enables
        // the camera/webcam. That's why image description AND the webcam did nothing
        // while the mic (capability-independent STT) worked. This baseline flips vision
        // on for all models. The farm's per-model supports_vision still decides whether
        // LiteLLM actually forwards the image to Ollama, so a text-only model simply has
        // its image dropped at the proxy (harmless). `web_search` gates OWUI's per-chat
        // globe toggle the same way — on only when the farm hosts a SearXNG.
        // Env-authoritative every launch, so it's zero-config across all clients.
        DEFAULT_MODEL_METADATA: JSON.stringify({
            capabilities: { vision: true, ...(input.searxngUrl ? { web_search: true } : {}) },
        }),

        // --- voice: fully LOCAL speech, no cloud (privacy + works on a closed LAN) ---
        // Speech-to-text: OWUI's built-in faster-whisper runs on THIS machine's CPU.
        // An empty AUDIO_STT_ENGINE selects that local engine (NOT OpenAI/cloud, and
        // not the browser "Web Speech" API — which doesn't exist in Electron). We pin
        // a small Whisper model so the one-time first-use download is quick.
        AUDIO_STT_ENGINE: '',            // '' = local faster-whisper (never cloud)
        WHISPER_MODEL: 'base',           // tiny|base|small — base ≈ 150 MB, good CPU speed
        // Text-to-speech: empty engine = handled client-side by the browser's Web
        // Speech voices (Chromium/OS voices) — offline, zero bundle cost, no farm hit.
        AUDIO_TTS_ENGINE: '',

        // --- keep the farm's inference slot for the USER's message (TTFT) ---
        // OWUI quietly runs EXTRA LLM calls around a chat, all against the same farm
        // endpoint. The farm's llama-server runs ONE inference slot
        // (llamacpp.parallel=1), so any background call still in flight makes the
        // user's next completion QUEUE behind it — felt as a long time-to-first-token
        // that LOL Chat (which sends only the completion) never showed. In the pinned
        // 0.10.2, follow-up-question generation and tag generation are default-ON and
        // fire after EVERY response — exactly when the user is typing their next
        // message. Off. Autocomplete is default-OFF in 0.10.2; pinned off so a future
        // pin bump can't silently re-enable per-keystroke completions. Title
        // generation stays ON: once per chat, a few tokens, and it's what names chats
        // in the sidebar. (Env names verified against the pinned OWUI's config.py;
        // ENABLE_PERSISTENT_CONFIG=false makes env authoritative.)
        ENABLE_AUTOCOMPLETE_GENERATION: 'false',
        ENABLE_FOLLOW_UP_GENERATION: 'false',
        ENABLE_TAGS_GENERATION: 'false',

        // --- default UI language: English (backend fallback; the Chromium --lang
        // switch in index.ts is what the frontend detector actually reads) ---
        DEFAULT_LOCALE: 'en-US',

        // --- telemetry fully off ---
        ANONYMIZED_TELEMETRY: 'false',
        DO_NOT_TRACK: 'true',
        SCARF_NO_ANALYTICS: 'true',

        // NOTE: we deliberately leave HF_HOME at its default (~/.cache/huggingface),
        // NOT under DATA_DIR. The ~90 MB MiniLM embedding model then downloads ONCE
        // per machine and is shared across data folders — so changing DATA_DIR (M4)
        // doesn't trigger a re-download or a huge cache copy. It's still 100% local;
        // only its location differs from the CLAUDE.md "cached under DATA_DIR" note.
    };

    // Point at the farm. Set ONLY the singular pair (the brief warns against also
    // setting the plural OPENAI_API_BASE_URLS — a config.py bug can reset the
    // singular back to the OpenAI default and mis-map keys↔URLs).
    if (input.endpoint) {
        env.ENABLE_OPENAI_API = 'true';
        env.OPENAI_API_BASE_URL = input.endpoint;
        // OWUI requires a non-empty key string even for a keyless LAN proxy.
        env.OPENAI_API_KEY = input.apiKey || 'sk-lol-lan';
        // Pre-select the farm's model so OWUI always has a default selected. Without
        // this, OWUI has no default over an OpenAI connection, so switching the served
        // model (via the `lol up` picker) leaves chats with a stale/blank selection and
        // the user must pick a model on every message. The client feeds the farm's own
        // advertised default here, so OWUI auto-selects whatever the farm serves —
        // env-authoritative each launch, and it re-applies when the model changes
        // (the sidecar restarts on repoint).
        if (input.defaultModel) env.DEFAULT_MODELS = input.defaultModel;
    } else {
        // No farm discovered yet → keep OWUI from reaching the public OpenAI API
        // (its default base URL) while we wait. Privacy intent: only the farm.
        env.ENABLE_OPENAI_API = 'false';
    }

    // Web search — the farm hosts one shared SearXNG and advertises it in the
    // beacon; point OWUI at it. The `/search?q=<query>` suffix is mandatory
    // (OWUI substitutes <query>). Search runs from THIS machine: OWUI queries
    // SearXNG, then fetches + locally embeds the result pages (data stays local).
    // No searxngUrl → no env → the feature stays hidden, exactly as before.
    if (input.searxngUrl) {
        env.ENABLE_WEB_SEARCH = 'true';
        env.WEB_SEARCH_ENGINE = 'searxng';
        env.SEARXNG_QUERY_URL = `${input.searxngUrl.replace(/\/+$/, '')}/search?q=<query>`;
        env.WEB_SEARCH_RESULT_COUNT = '3';
        env.WEB_SEARCH_CONCURRENT_REQUESTS = '10';
    }

    // Neural TTS — the farm hosts a shared Kokoro voice server and advertises it in
    // the beacon; point OWUI's OpenAI-compatible TTS at it (overriding the empty
    // client-side default above). No farm TTS → AUDIO_TTS_ENGINE stays '' (Web
    // Speech), exactly as before. The URL already ends in /v1.
    if (input.tts && input.tts.url) {
        env.AUDIO_TTS_ENGINE = 'openai';
        env.AUDIO_TTS_OPENAI_API_BASE_URL = input.tts.url;
        env.AUDIO_TTS_OPENAI_API_KEY = 'sk-lol-tts';   // keyless LAN server; OWUI needs a non-empty key
        env.AUDIO_TTS_MODEL = input.tts.model || 'kokoro';
        env.AUDIO_TTS_VOICE = input.tts.voice || 'af_heart';
    }

    // Document OCR — the farm hosts one shared "lol-extract" service and advertises
    // it in the beacon; point OWUI's content-extraction engine at it so every
    // uploaded image / scanned PDF is OCR'd (searchable AND transcribable) with zero
    // client setup. This is the ONLY OWUI surface that receives an uploaded file's
    // bytes (external tool servers never do — verified against OWUI 0.10.2), so both
    // the RAG and vision-transcript goals funnel through this one engine. OWUI does
    // PUT <url>/process itself; the loader requires BOTH a url AND a non-empty key.
    // The raw file transits to the trusted-LAN farm for extraction (that's where the
    // GPU/vision model is), same trust boundary as SearXNG receiving queries;
    // embedding still happens locally (RAG_EMBEDDING_ENGINE stays unset). No farm OCR
    // → nothing set → OWUI's built-in default extractor, exactly as before.
    if (input.extract && input.extract.url) {
        env.CONTENT_EXTRACTION_ENGINE = 'external';
        env.EXTERNAL_DOCUMENT_LOADER_URL = input.extract.url.replace(/\/+$/, '');
        env.EXTERNAL_DOCUMENT_LOADER_API_KEY = input.extract.key || 'sk-lol-ocr';
    }

    // NOTE: the local Blender assistant-tools server (mcpo) is NOT wired here.
    // TOOL_SERVER_CONNECTIONS is a PersistentConfig and OWUI does not reliably surface
    // env-configured tool servers (upstream issue #18140 — env is "not a supported
    // method"). Instead the renderer registers the tool server through OWUI's own
    // supported user-settings API (POST /api/v1/users/user/settings/update) from the authed webview, the
    // same way seedWebSearchDefault() sets the web-search default — see app.js.

    return env;
}

// The OWUI branding stays intact (invariant #2) — we never set WEBUI_NAME, so it
// keeps its own name. Exposed for documentation/tests.
export const OWUI_BRANDING_UNTOUCHED = true;
