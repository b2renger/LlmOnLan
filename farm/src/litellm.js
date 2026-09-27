// Generate the LiteLLM proxy config.yaml from lol.config.json.
//
// The whole point: each Ollama host becomes a *deployment* of the same
// `model_name`. LiteLLM's router then load-balances across deployments that
// share a model_name and fails over when one is down — so a client asking for
// `gemma4:12b` is transparently spread across every box, and a dead box drops
// out via the cooldown. LOL never hand-edits routing; it's derived here.
//
// Refs: docs.litellm.ai (Ollama provider, routing/load-balancing, proxy config).

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Model families that accept IMAGE input (Ollama multimodal). We flag these with
// `model_info.supports_vision` below. Why it matters: with `drop_params: true`,
// LiteLLM STRIPS the image_url content from a request bound for a model it thinks
// is text-only (its cost map doesn't know our Ollama tags), so the picture never
// reaches Ollama and the model "can't see" it — the classic OWUI+LiteLLM "image
// attached but ignored" bug. Flagging vision keeps the images in the request.
// Note gemma4 (all sizes) is natively multimodal, as are llava/*-vl/*-vision/etc.
// Note qwen3.8 (all sizes) is natively multimodal — text/image/video — but its tag
// contains no "vl"/"vision" marker, so it needs an explicit pattern here or images
// get silently stripped. That also covers derived local names like
// "qwen3.8-27b-iq2xxs" and HF tags like "hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ2_XXS".
const VISION_MODEL_RX = /(gemma-?4|llava|bakllava|vision|qwen[\w.]*-?vl|qwen-?3\.?8|[-_]vl(?:[:@\-]|$)|minicpm-?v|moondream|pixtral|internvl|cogvlm|smolvlm)/i;

// Does this model take images? An explicit `vision: true|false` in the config
// wins; otherwise infer from the tag so existing configs "just work".
function modelSupportsVision(model) {
    if (typeof model.vision === 'boolean') return model.vision;
    return VISION_MODEL_RX.test(model.id);
}

// The client-facing served model(s): each is { servedName, underlying, vision,
// isDefault }. EVERY model in the run's catalog is served; the name clients see:
//   • the model's own `alias` when set (multi-role: assistant / coder / …),
//   • else, for the DEFAULT model, the global `modelAlias` when set,
//   • else the raw Ollama id.
// Aliases decouple the id an OWUI chat binds to from the Ollama tag behind it, so
// swapping the underlying model (via the picker) never breaks a chat. Shared by
// the LiteLLM generator AND the snapshot so routing and advertising can't drift.
// Ollama's per-request keep_alive is Go's api.Duration: a JSON NUMBER is seconds
// (negative = keep forever), a JSON STRING must carry a unit ("5m"). The config
// keeps it a string because OLLAMA_KEEP_ALIVE (env) takes the same spelling — but
// emitting a bare numeric string ("-1") into the routing made Ollama reject EVERY
// completion with `time: missing unit in duration "-1"`. Coerce numeric spellings
// to numbers; pass real durations ("5m", "2h") through.
function keepAliveValue(v) {
    return /^-?\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : v;
}

function servedEntries(config) {
    const globalAlias = (config.modelAlias || '').trim();
    const hasDefault = config.models.some((m) => m.default);
    return config.models.map((m, i) => {
        const isDefault = !!m.default || (!hasDefault && i === 0);
        const ownAlias = (m.alias || '').trim();
        const servedName = ownAlias || (isDefault && globalAlias ? globalAlias : m.id);
        return { servedName, underlying: m.id, vision: modelSupportsVision(m), isDefault };
    });
}

// Is the OLLAMA engine the one answering chat? One engine at a time (owner decision
// 2026-08-26): while llama.cpp or an operator-run external server serves, the Ollama
// catalog is STANDBY inventory — not routed, not advertised — and nothing may warm,
// probe or re-route it as if it were serving. Every exclusivity check goes through
// this; testing only `llamacpp.enabled` (as the code once did) treated an external
// engine as "Ollama serves" and let the panel load models next to vLLM.
function ollamaServes(config) {
    return !(config.llamacpp && config.llamacpp.enabled) && !(config.external && config.external.enabled);
}

// The catalog entry clients auto-select on the Ollama engine (same rule as
// servedEntries: the flagged default, else the first).
function defaultModelEntry(config) {
    const models = config.models || [];
    return models.find((m) => m.default) || models[0] || null;
}

// Would giving the default model `name` collide with ANOTHER served model's name?
// A duplicate model_name silently merges two models into one route.
function nameTakenByOther(config, name) {
    const def = defaultModelEntry(config);
    return (config.models || []).some((m) => m !== def && ((m.alias || '').trim() || m.id) === name);
}

// A NAME PLAN is how the advertised name moves between engines, as data: keys present
// are set, absent keys are left alone.
//   { llamacppAlias }  → config.llamacpp.alias
//   { modelAlias }     → config.modelAlias (null clears it)
//   { defaultAlias }   → the default catalog entry's own `alias` (null removes it)
// Plans are computed by the pure functions below and applied by applyNamePlan (memory)
// and, for a real engine switch only, persisted by the caller (up.js).

// Carry the advertised name across an engine SWITCH. The name IS the model id clients
// bind to, so a switch that renames the model makes every open chat ask to re-pick.
//   → llama.cpp: the default Ollama model's SERVED name (its own alias, else the
//     global modelAlias) becomes llamacpp.alias. A raw checkpoint id is not carried —
//     llama.cpp serving a different model under "gemma4:12b" would be a lie. modelAlias
//     is cleared so llamacpp.alias is the ONE source of truth while llama.cpp serves
//     (a stale copy would win a later fallback).
//   → Ollama: llamacpp.alias goes onto the default entry's own alias when it has one
//     (per-model naming is how the panel names Ollama models), else into modelAlias.
function carryNameAcross(config, toLlamacpp) {
    const plan = {};
    const lc = config.llamacpp || {};
    if (toLlamacpp) {
        const def = servedEntries(config).find((e) => e.isDefault);
        if (def && def.servedName !== def.underlying && def.servedName !== lc.alias) plan.llamacppAlias = def.servedName;
        if ((config.modelAlias || '').trim()) plan.modelAlias = null;
        return plan;
    }
    const name = (lc.alias || '').trim();
    const def = defaultModelEntry(config);
    if (!name || !def || nameTakenByOther(config, name)) return plan;
    const own = (def.alias || '').trim();
    if (own) { if (own !== name) plan.defaultAlias = name; }
    else if ((config.modelAlias || '').trim() !== name) plan.modelAlias = name;
    return plan;
}

// The name the Ollama engine serves when it takes over by FALLBACK (the configured
// engine could not start, or died). Chats are bound to the failed engine's alias, and
// a fallback that serves raw checkpoint ids breaks every one of them for the whole
// run. Unlike a switch, the operator's own Ollama naming wins: only a default nobody
// named gets the engine's alias.
function fallbackNamePlan(config, engineAlias) {
    const name = (engineAlias || '').trim();
    const def = defaultModelEntry(config);
    if (!name || !def) return {};
    if ((def.alias || '').trim() || (config.modelAlias || '').trim()) return {};
    if (nameTakenByOther(config, name)) return {};
    return { modelAlias: name };
}

// Apply a name plan to the in-memory config. Returns the config.
function applyNamePlan(config, plan) {
    if (!plan) return config;
    if ('llamacppAlias' in plan) config.llamacpp.alias = plan.llamacppAlias;
    if ('modelAlias' in plan) config.modelAlias = plan.modelAlias;
    if ('defaultAlias' in plan) {
        const def = defaultModelEntry(config);
        if (def) { if (plan.defaultAlias) def.alias = plan.defaultAlias; else delete def.alias; }
    }
    return config;
}

// A configured engine is off for THIS RUN (boot probe failed, no prebuilt, start
// failure, crashed twice). IN MEMORY ONLY: the operator's file keeps the engine
// enabled so the next boot retries, and the fallback's names are never written.
//   'external' → the built-in engine that stands in (llama.cpp when enabled, else
//                Ollama) serves under the external alias.
//   'llamacpp' → Ollama serves, under llamacpp.alias unless the default is named.
// Returns the plan it applied (for the log line).
function engineFallback(config, engine) {
    let plan;
    if (engine === 'external') {
        const alias = (config.external.alias || '').trim();
        config.external.enabled = false;
        plan = config.llamacpp.enabled
            ? (alias && alias !== config.llamacpp.alias ? { llamacppAlias: alias } : {})
            : fallbackNamePlan(config, alias);
    } else {
        config.llamacpp.enabled = false;
        plan = fallbackNamePlan(config, config.llamacpp.alias);
    }
    applyNamePlan(config, plan);
    return plan;
}

// Build the config.yaml object (model_list × hosts + router/proxy settings).
//
// `peers` (coordinator mode) is a list of OTHER farms discovered on the LAN:
// { openaiBaseUrl, models:[ids], key? }. Each becomes an `openai/<model>`
// deployment of the same model_name, so the router shuffle-balances across peer
// proxies (each of which balances across its own Ollama) — one endpoint, whole
// fleet, same failover. Empty in the normal single-box case.
function buildLitellmConfig(config, peers = []) {
    const provider = config.litellm.provider; // 'ollama_chat' | 'ollama'
    const model_list = [];

    // llama.cpp backend: one OpenAI-compatible deployment, exactly the shape already
    // used for peer farms. The engines are EXCLUSIVE: while llama.cpp serves, NO
    // local Ollama deployment is emitted at all (owner decision, 2026-08-26 — one
    // engine at a time). It is also what a small GPU needs: a client picking an
    // Ollama model while llama-server holds ~9 GB of a 12 GB card overcommits VRAM
    // and everything crawls. The catalog stays in the config as STANDBY inventory —
    // served the moment the engine is switched — and the OCR plugin still drives its
    // vision model over raw Ollama (that path never went through this routing).
    // External engine (vLLM/SGLang/… — a server the operator runs, not us). Same
    // deployment shape as llama.cpp below; it just points off-box-or-off-port
    // instead of at a child we spawned. Exclusive for the same reason: two engines
    // sharing one GPU overcommit VRAM and everything crawls.
    const ex = config.external || {};
    if (ex.enabled) {
        const entry = {
            model_name: ex.alias,
            litellm_params: {
                // `model` is what the BACKEND is asked for; model_name is what clients
                // request. null = pass the alias through (a server started with
                // --served-model-name <alias> already answers to it).
                model: `openai/${ex.model || ex.alias}`,
                api_base: ex.baseUrl,
                api_key: ex.apiKey || 'sk-lol-external',   // keyless servers ignore it
            },
        };
        // No projector to inspect and no portable capability endpoint — the operator
        // declares it (config.external.vision). Flagging a text-only model as vision
        // makes OWUI offer an image upload that then fails.
        if (ex.vision) entry.model_info = { supports_vision: true };
        model_list.push(entry);
        // Peers still aggregate: exclusivity is about this box's engines, not the
        // fleet (same rule as the llama.cpp branch — see the note there).
        for (const peer of peers) {
            if (!peer || !peer.openaiBaseUrl) continue;
            const peerModels = new Set((peer.models || []).map((m) => (typeof m === 'string' ? m : m.id)));
            if (peerModels.size && !peerModels.has(ex.alias)) continue;
            model_list.push({
                model_name: ex.alias,
                litellm_params: {
                    model: `openai/${ex.alias}`,
                    api_base: peer.openaiBaseUrl,
                    api_key: peer.key || 'sk-lol-coordinator',
                },
                ...(ex.vision ? { model_info: { supports_vision: true } } : {}),
            });
        }
    }

    const lc = config.llamacpp || {};
    if (lc.enabled && !ex.enabled) {
        const host = lc.host === '0.0.0.0' ? '127.0.0.1' : lc.host;
        const entry = {
            model_name: lc.alias,
            litellm_params: {
                model: `openai/${lc.alias}`,
                api_base: `http://${host}:${lc.port}/v1`,
                api_key: 'sk-lol-llamacpp',   // llama-server is keyless; LiteLLM wants a value
            },
        };
        // Vision only when the model actually HAS a projector — a text-only .gguf
        // flagged as vision makes OWUI offer image upload that then fails.
        if (lc.mmproj) entry.model_info = { supports_vision: true };
        model_list.push(entry);
        // Coordinator peers STILL aggregate in llama.cpp mode — exclusivity is about
        // this box's two local engines, not the fleet. The fleet shares one alias, so
        // peers serving it become extra deployments of the same model_name and the
        // router balances across boxes. (Without this, a llama.cpp coordinator
        // aggregated nobody: the peer loop below lives inside the Ollama loop that
        // exclusivity skips — found by the exclusivity test, fixed here.)
        for (const peer of peers) {
            if (!peer || !peer.openaiBaseUrl) continue;
            const peerModels = new Set((peer.models || []).map((m) => (typeof m === 'string' ? m : m.id)));
            if (peerModels.size && !peerModels.has(lc.alias)) continue;
            model_list.push({
                model_name: lc.alias,
                litellm_params: {
                    model: `openai/${lc.alias}`,
                    api_base: peer.openaiBaseUrl,
                    api_key: peer.key || 'sk-lol-coordinator',
                },
                model_info: { supports_vision: true },
            });
        }
    }

    for (const { servedName, underlying, vision } of servedEntries(config)) {
        // One engine at a time — see the note above. Either non-Ollama engine
        // suppresses the whole local catalog (it stays standby inventory).
        if (!ollamaServes(config)) continue;
        // Local Ollama deployments. In alias mode `servedName` is the fixed alias and
        // `underlying` is the real Ollama tag it routes to; otherwise they're equal.
        for (const host of config.ollama.hosts) {
            const entry = {
                model_name: servedName,                    // what clients request (stable in alias mode)
                litellm_params: {
                    // ollama_chat = use Ollama's chat endpoint w/ proper templating.
                    model: `${provider}/${underlying}`,
                    api_base: host,
                    // Per-request context window (→ Ollama options.num_ctx; verified to
                    // survive drop_params in the pinned LiteLLM). This is what makes
                    // config.ollama.contextLength apply on EVERY host — the
                    // OLLAMA_CONTEXT_LENGTH env only reaches Ollamas this CLI starts —
                    // and what lets the admin panel change it live (proxy bounce).
                    // Without it, Ollama's 4096 default silently truncates long
                    // prompts (whole-document chat = "the model ignored half my PDF").
                    // 'auto' is resolved to contextResolved before this runs (up.js
                    // resolveOllamaContext); the floor covers a config regenerated
                    // before resolution (never ship the string into the routing).
                    num_ctx: config.ollama.contextResolved
                        ?? (typeof config.ollama.contextLength === 'number' ? config.ollama.contextLength : 16384),
                    // Keep-warm rides EVERY request (Ollama honors per-request
                    // keep_alive over its server default). Without this, any user
                    // request reset the model's expiry to the server default — after
                    // a llama.cpp→Ollama fallback that default is 5m, and every user
                    // after a pause ate a 30-60 s model reload.
                    keep_alive: keepAliveValue(config.ollama.keepAlive),
                },
            };
            // Tell LiteLLM this deployment accepts images so drop_params doesn't
            // strip them (see VISION_MODEL_RX above). Advertised on /v1/models too,
            // which lets OWUI light up the image UI for the model.
            if (vision) entry.model_info = { supports_vision: true };
            model_list.push(entry);
        }
        // Peer-farm deployments (coordinator mode): each peer's LiteLLM is an
        // OpenAI-compatible endpoint. Only add peers that serve this served name
        // (in alias mode the fleet shares the alias).
        for (const peer of peers) {
            if (!peer || !peer.openaiBaseUrl) continue;
            const peerModels = new Set((peer.models || []).map((m) => (typeof m === 'string' ? m : m.id)));
            if (peerModels.size && !peerModels.has(servedName)) continue;
            const entry = {
                model_name: servedName,
                litellm_params: {
                    model: `openai/${servedName}`,         // talk to the peer's OpenAI API
                    api_base: peer.openaiBaseUrl,          // http://<peer>:<port>/v1
                    api_key: peer.key || 'sk-lol-coordinator', // keyless peers ignore it
                },
            };
            if (vision) entry.model_info = { supports_vision: true };
            model_list.push(entry);
        }
    }

    const doc = {
        model_list,
        router_settings: {
            // least-busy routes each request to the deployment with the fewest
            // IN-FLIGHT calls — for GPU inference, active requests ARE the live
            // load, so a box mid-generation stops receiving new work while an
            // idle box does (the PAIR-style live routing, owner ask 2026-09-04,
            // without leaving LiteLLM where num_ctx/keep_alive/aliasing live).
            // In-memory state — correct for our single proxy instance per farm.
            // Only matters with 2+ deployments (multi ollama.hosts / coordinator
            // peers); with one deployment it degenerates to what shuffle did.
            routing_strategy: 'least-busy',
            // A failed call is retried on OTHER deployments of the same model, so a
            // dead host is transparently routed around. 3 retries × N deployments
            // gives a request a strong chance of landing on a healthy host.
            num_retries: 3,
            // Cool a deployment out of rotation after a SINGLE failure (fast
            // failover when a node dies — minimizes user-visible errors) …
            allowed_fails: 1,
            // … and keep it out for a minute before retrying it.
            cooldown_time: 60,
        },
        litellm_settings: {
            // Silently drop params a model doesn't support instead of erroring —
            // keeps OWUI's extra OpenAI params from breaking Ollama.
            drop_params: true,
            // Don't phone home.
            telemetry: false,
        },
        general_settings: {},
    };

    // Auth: only require a key if the operator set one. An unset key => open proxy
    // (trusted LAN). LiteLLM treats master_key as the admin/virtual key clients send.
    if (config.proxy.masterKey) {
        doc.general_settings.master_key = config.proxy.masterKey;
    }

    return doc;
}

function toYaml(doc) {
    return yaml.dump(doc, { lineWidth: 120, noRefs: true });
}

// Default on-disk location for the generated config (gitignored).
function generatedConfigPath() {
    return path.join(__dirname, '..', 'litellm', 'config.generated.yaml');
}

// Write the generated config; returns the path written. `peers` (coordinator
// mode) adds peer-farm deployments — see buildLitellmConfig.
function writeLitellmConfig(config, outPath = generatedConfigPath(), peers = []) {
    const header =
        '# GENERATED by `lol` from lol.config.json — do NOT edit by hand.\n' +
        '# Re-run `lol up` to regenerate. Routing is derived, never authored.\n';
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, header + toYaml(buildLitellmConfig(config, peers)), 'utf8');
    return outPath;
}

module.exports = {
    buildLitellmConfig, toYaml, generatedConfigPath, writeLitellmConfig, modelSupportsVision, servedEntries,
    ollamaServes, defaultModelEntry, carryNameAcross, fallbackNamePlan, applyNamePlan, engineFallback,
};
