// Document search on the farm (owner, 2026-10-08; docs/EMBEDDINGS_STUDY.md): ONE llama-server in embedding mode with
// ONE pinned EmbeddingGemma 2. Open WebUI on each laptop sends the text of a document's pieces (and of a search) here,
// gets the vectors back and keeps them; this service keeps nothing and never logs a text (llama-server's default log
// level writes token counts only, and LLAMA_* variables from the box's environment are dropped, so nothing can turn
// its prompt log on). The model is a code constant: every farm of one LOL release serves the same vectors, and a
// laptop checks `contract` before it uses them (shell configBridge.ts). A new model is a new contract and a release.
//
// It reuses the llama.cpp engine's own build (llamacpp.js: the pinned download, or llamacpp.binDir) and the farm's
// .gguf cache (farm/.models). Shape of the other plugins: ensure → spawn → waitFor → alive. Its own port and key,
// outside the seat gate: a search takes no seat.

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const llamacpp = require('./llamacpp');
const { downloadGguf, ggufPathFor } = require('./ollama');
const { serviceHosts } = require('./net');
const log = require('./log');

// The model of this LOL release. ggml-org's own conversion of google/embeddinggemma-2 (source revision 914f7f89,
// converted with llama.cpp's convert_hf_to_gguf.py --outtype bf16), pinned by revision AND sha256. BF16 is the
// laptop's float32 to the last digit (cosine 1.0000 against sentence-transformers, measured 2026-10-08), so a laptop
// that one day computes these vectors itself gets the same ones.
const MODEL = Object.freeze({
    id: 'embeddinggemma-2',               // the name the laptops send as `model` (llama-server's --alias)
    contract: 'embeddinggemma-2/768/v1',  // same text → same vector: this model, 768 numbers, the prefixes below
    dims: 768,
    queryPrefix: 'task: search result | query: ',
    docPrefix: 'title: none | text: ',
    url: 'https://huggingface.co/ggml-org/embeddinggemma-2-GGUF/resolve/bfcd298762cc34d0357ece5ebdd31791a3a374d8/embeddinggemma-2-BF16.gguf',
    sha256: '68bae29d62fb8c7d23e98d21fd4662753ddd636e6b62b8a70dfe059a9844f216',
    bytes: 557950176,
});
// llama.cpp learned EmbeddingGemma 2 ('gemma-embedding2') in b11454.
const MIN_BUILD = 11454;
// GPU memory it holds: 1.05 GB loaded, 1.16 GB at its peak (8 slots of 2048 tokens; RTX PRO 6000, b11512,
// 2026-10-08), rounded up. vLLM's Automatic memory keeps it free while this service is on but not running yet.
const RESERVE_GIB = 1.5;
// ponytail: 2048 tokens per text (an Open WebUI piece is ~1000 characters). Longer is refused, not cut: a search
// typed longer than ~8000 characters finds nothing on a farm under 24k tokens per person. 4096 costs +0.5 GB, 8192
// +1.9 GB (measured).
const SLOTS = 8;
const TOKENS = 2048;

const IS_WIN = process.platform === 'win32';
const buildNumber = (tag) => Number(String(tag || '').replace(/^b/, '')) || 0;
const binFor = (binDir) => path.join(binDir || llamacpp.BIN_DIR, IS_WIN ? 'llama-server.exe' : 'llama-server');
const modelPath = () => ggufPathFor(MODEL.url);

// Can this farm run it at all, before downloading anything: a llama.cpp folder the operator chose, or the farm's
// own build when it exists for this computer and is new enough. → { ok, message }.
function available(config) {
    if (config.llamacpp && config.llamacpp.binDir) return { ok: true, message: null };
    if (!llamacpp.supported()) return { ok: false, message: 'Document search is not available on this computer: there is no ready-made llama.cpp for it.' };
    if (buildNumber(llamacpp.PINNED_BUILD) < MIN_BUILD) {
        return { ok: false, message: `Document search needs a newer llama.cpp than this farm has (${llamacpp.PINNED_BUILD}): it comes with a farm update.` };
    }
    return { ok: true, message: null };
}

// Off, on, or 'auto' (the default): on when this computer has an NVIDIA GPU and can run it (~1.2 GB of its memory).
function autoEnabled(config, hw) {
    return !!(hw && hw.gpu && hw.gpu !== 'Unknown GPU') && available(config).ok;
}
function resolveEnabled(config, hw) {
    if (config.embed.enabled === 'auto') config.embed.enabled = autoEnabled(config, hw);
    return config.embed.enabled;
}

// Everything on disk already (a boot then starts it before the engine sizes its memory; otherwise it starts once the
// farm is public, so a first download never keeps the farm shut).
function ready(config) {
    const binDir = config.llamacpp && config.llamacpp.binDir;
    const bin = binDir ? fs.existsSync(binFor(binDir)) : llamacpp.installed() && llamacpp.installedBuild() === llamacpp.PINNED_BUILD;
    try { return bin && fs.statSync(modelPath()).size === MODEL.bytes; } catch { return false; }
}

function sha256Of(file) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('sha256');
        fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
}

// The llama.cpp build (unless binDir) and the model, checked by its sha256 once downloaded. Returns true when it can
// start; false with the reason logged (the farm then runs without document search).
// ponytail: the llama.cpp engine's own start fetches the same build; both downloading at the same moment (a first
// install racing a switch to llama.cpp) is not guarded.
async function ensureEmbed(config, onProgress = () => {}) {
    const a = available(config);
    if (!a.ok) { log.warn(a.message); return false; }
    try {
        const binDir = config.llamacpp && config.llamacpp.binDir;
        if (!binDir) {
            const got = await llamacpp.ensureLlamacpp(onProgress);
            if (!got.ok) { log.warn(`Document search: ${got.message}`); return false; }
        } else if (!fs.existsSync(binFor(binDir))) {
            log.warn(`Document search: no llama-server in ${binDir}.`);
            return false;
        }
        const p = modelPath();
        let size = 0;
        try { size = fs.statSync(p).size; } catch { /* not downloaded yet */ }
        if (size && size !== MODEL.bytes) fs.rmSync(p, { force: true });   // a different file under its name
        if (size !== MODEL.bytes) {
            const got = await downloadGguf(MODEL.url, (pct) => onProgress('document search model', pct));
            if ((await sha256Of(got.path)) !== MODEL.sha256) {
                fs.rmSync(got.path, { force: true });
                log.warn('Document search: the model downloaded is not the one this farm expects (its checksum differs). It was deleted; the next start downloads it again.');
                return false;
            }
        }
        return true;
    } catch (e) {
        log.warn(`Document search could not be installed (${e.message}). The farm runs without it.`);
        return false;
    }
}

// llama-server's argv. The key is NOT here: it goes in LLAMA_API_KEY (spawnEmbed), out of the process list.
function argsFor(config) {
    return [
        '--model', modelPath(),
        '--alias', MODEL.id,
        '--host', serviceHosts(config.proxy && config.proxy.host).bind,
        '--port', String(config.embed.port),
        '--embeddings',
        '--parallel', String(SLOTS),
        '--ctx-size', String(SLOTS * TOKENS),
        '--batch-size', String(TOKENS),
        '--ubatch-size', String(TOKENS),   // an embedding is computed in one piece: the longest text it takes
        '--n-gpu-layers', '99',
        '--no-webui',
        '--no-slots',                      // /slots would show what a slot holds
        '--cache-ram', '0',                // no copy of past inputs in RAM
    ];
}

// opts = { key }. `spawnFn` is for tests.
function spawnEmbed(config, opts, spawnFn = spawn) {
    // Only the box's own variables, never a LLAMA_* one: those set llama-server's flags (LLAMA_ARG_LOG_PROMPTS_DIR
    // would write every text to disk).
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^LLAMA_/i.test(k)));
    env.LLAMA_API_KEY = opts.key;
    return spawnFn(binFor(config.llamacpp && config.llamacpp.binDir), argsFor(config), {
        windowsHide: true,
        detached: !IS_WIN,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function request(method, url, { body = null, key = null, timeoutMs = 4000 } = {}) {
    return new Promise((resolve) => {
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const req = http.request(url, {
            method, timeout: timeoutMs,
            headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...(key ? { authorization: `Bearer ${key}` } : {}) },
        }, (res) => {
            let b = '';
            res.on('data', (c) => { if (b.length < 65536) b += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: b }));
            res.on('error', () => resolve(null));
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
        if (data) req.write(data);
        req.end();
    });
}

// The contract, checked on the running server: one search gives MODEL.dims numbers. → null, or what is wrong.
async function checkContract(host, port, key) {
    const r = await request('POST', `http://${host}:${port}/v1/embeddings`, { key, body: { model: MODEL.id, input: [`${MODEL.queryPrefix}ok`] }, timeoutMs: 30000 });
    if (!r || r.status !== 200) return `it did not answer a test search (${r ? `HTTP ${r.status}` : 'no answer'})`;
    let n = null;
    try { n = JSON.parse(r.body).data[0].embedding.length; } catch { /* checked below */ }
    return n === MODEL.dims ? null : `its vectors have ${n} numbers, not ${MODEL.dims}`;
}

// Ready = /health answers 200 (the model is loaded) and a test search gives 768 numbers. `isDead` ends the wait.
async function waitForEmbed(port, key, host = '127.0.0.1', isDead = () => false, timeoutMs = 120000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (isDead()) return { up: false };
        const r = await request('GET', `http://${host}:${port}/health`);
        if (r && r.status === 200) {
            const wrong = await checkContract(host, port, key);
            return wrong ? { up: false, error: wrong } : { up: true };
        }
        await new Promise((res) => setTimeout(res, 500));
    }
    return { up: false };
}

async function embedAlive(port, host = '127.0.0.1') {
    const r = await request('GET', `http://${host}:${port}/health`, { timeoutMs: 3000 });
    return !!(r && r.status === 200);
}

module.exports = {
    MODEL, MIN_BUILD, RESERVE_GIB, available, autoEnabled, resolveEnabled, ready,
    ensureEmbed, argsFor, spawnEmbed, waitForEmbed, embedAlive, checkContract, sha256Of,
};
