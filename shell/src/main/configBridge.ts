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
}

// Build the environment Open WebUI is launched with. This is the whole coupling.
export function buildSidecarEnv(input: SidecarEnvInput): Record<string, string> {
    const env: Record<string, string> = {
        // --- data locality (invariant #3): everything lives under DATA_DIR ---
        DATA_DIR: input.dataDir,
        WEBUI_SECRET_KEY: getSecretKey(),

        // --- kiosk / single-user: no login ceremony (data is already per-user + local) ---
        WEBUI_AUTH: 'false',

        // --- env is authoritative every launch (no stale persisted farm URL) ---
        ENABLE_PERSISTENT_CONFIG: 'false',

        // --- connection: talk ONLY to the farm's OpenAI-compatible endpoint ---
        // ENABLE_OPENAI_API is set below — true only when we have a farm endpoint,
        // so a no-farm boot can't fall back to OWUI's default api.openai.com.
        ENABLE_OLLAMA_API: 'false',   // never hit Ollama directly; the farm fronts it

        // --- privacy: documents embed LOCALLY (default MiniLM); never to the farm ---
        // RAG_EMBEDDING_ENGINE is deliberately UNSET → in-process SentenceTransformers.
        // (Setting it to "ollama"/"openai" would ship document text off-device.)

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
    } else {
        // No farm discovered yet → keep OWUI from reaching the public OpenAI API
        // (its default base URL) while we wait. Privacy intent: only the farm.
        env.ENABLE_OPENAI_API = 'false';
    }

    return env;
}

// The OWUI branding stays intact (invariant #2) — we never set WEBUI_NAME, so it
// keeps its own name. Exposed for documentation/tests.
export const OWUI_BRANDING_UNTOUCHED = true;
