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
const VISION_MODEL_RX = /(gemma-?4|llava|bakllava|vision|qwen[\w.]*-?vl|[-_]vl(?:[:@\-]|$)|minicpm-?v|moondream|pixtral|internvl|cogvlm|smolvlm)/i;

// Does this model take images? An explicit `vision: true|false` in the config
// wins; otherwise infer from the tag so existing configs "just work".
function modelSupportsVision(model) {
    if (typeof model.vision === 'boolean') return model.vision;
    return VISION_MODEL_RX.test(model.id);
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
    for (const model of config.models) {
        const visionCapable = modelSupportsVision(model);
        // Local Ollama deployments.
        for (const host of config.ollama.hosts) {
            const entry = {
                model_name: model.id,                      // what clients request
                litellm_params: {
                    // ollama_chat = use Ollama's chat endpoint w/ proper templating.
                    model: `${provider}/${model.id}`,
                    api_base: host,
                },
            };
            // Tell LiteLLM this deployment accepts images so drop_params doesn't
            // strip them (see VISION_MODEL_RX above). Advertised on /v1/models too,
            // which lets OWUI light up the image UI for the model.
            if (visionCapable) entry.model_info = { supports_vision: true };
            model_list.push(entry);
        }
        // Peer-farm deployments (coordinator mode): each peer's LiteLLM is an
        // OpenAI-compatible endpoint. Only add peers that actually serve this model.
        for (const peer of peers) {
            if (!peer || !peer.openaiBaseUrl) continue;
            const peerModels = new Set((peer.models || []).map((m) => (typeof m === 'string' ? m : m.id)));
            if (peerModels.size && !peerModels.has(model.id)) continue;
            const entry = {
                model_name: model.id,
                litellm_params: {
                    model: `openai/${model.id}`,           // talk to the peer's OpenAI API
                    api_base: peer.openaiBaseUrl,          // http://<peer>:<port>/v1
                    api_key: peer.key || 'sk-lol-coordinator', // keyless peers ignore it
                },
            };
            if (visionCapable) entry.model_info = { supports_vision: true };
            model_list.push(entry);
        }
    }

    const doc = {
        model_list,
        router_settings: {
            // simple-shuffle spreads load with no extra state; good default for a LAN.
            routing_strategy: 'simple-shuffle',
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

module.exports = { buildLitellmConfig, toYaml, generatedConfigPath, writeLitellmConfig, modelSupportsVision };
