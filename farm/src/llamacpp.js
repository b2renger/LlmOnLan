// llama.cpp (`llama-server`) as an ALTERNATIVE inference backend to Ollama.
//
// Why it exists: on a 12 GB card you cannot get speculative decoding out of Ollama
// for Qwen3.8. Measured on the fleet's hardware —
//   • UD-IQ2_XXS  fits (~9.9 GB) but Unsloth STRIPS its MTP head, so
//     `draft_num_predict` is inert and there is no speculative decoding at all.
//   • UD-IQ2_XXS + the separate 1.3 GB MTP module needs ~11.0 GB -> spills.
//   • UD-Q2_K_XL keeps its MTP head but needs ~11 GB under Ollama -> spills,
//     because Ollama's KV-cache quantization does not engage for this model.
// llama-server closes that gap: it exposes explicit KV quantization, so
// UD-Q2_K_XL + built-in MTP + q4_0 KV lands at ~10.6 GB and MEASURED 154.8 tok/s
// with a 0.13 s TTFT (vs 122.4 tok/s / 0.28 s for the Ollama IQ2_XXS config).
//
// It is a per-farm OPT-IN (llamacpp.enabled). Nothing about the client changes:
// llama-server is OpenAI-compatible, so LiteLLM fronts it exactly like a peer farm
// and the shell cannot tell the difference.
//
// Shape mirrors kokoro.js / searxng.js: ensure -> spawn -> waitFor -> alive.

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const { downloadGguf } = require('./ollama');

// Pinned llama.cpp build. `--spec-type draft-mtp` (the flag that activates a GGUF's
// built-in NextN/MTP head) landed in PR #22673; this build has it — verified by
// `llama-server --help`.
const PINNED_BUILD = 'b10516';
const CUDA_TAG = 'cuda-13.3';   // sm_120/Blackwell needs CUDA >= 12.8; 13.3 covers 40-series too

const ROOT = path.join(__dirname, '..', '.llamacpp');
const BIN_DIR = path.join(ROOT, 'bin');
const BUILD_FILE = path.join(ROOT, '.installed-build');
const IS_WIN = process.platform === 'win32';

function serverBin() {
    return path.join(BIN_DIR, IS_WIN ? 'llama-server.exe' : 'llama-server');
}

// Which release assets this platform needs, and from WHERE. Windows/x64 comes from
// ggml-org's own releases. linux-arm64 — the DGX Spark (GB10, sm_121) — has no
// upstream prebuilt, so OUR CI builds it (.github/workflows/build-llamacpp-arm64.yml,
// GitHub's arm64 runners + the CUDA sbsa toolchain) and publishes it on this repo's
// releases under the `llamacpp-<build>` tag: the Spark installs out of the box, no
// compiler, no Docker. Anything else: the operator installs llama.cpp themselves and
// points `llamacpp.binDir` at it — a supported path, and `lol up` falls back to the
// Ollama engine rather than failing when they have not.
const GGML_BASE = `https://github.com/ggml-org/llama.cpp/releases/download/${PINNED_BUILD}`;
const OUR_BASE = `https://github.com/b2renger/LlmOnLan/releases/download/llamacpp-${PINNED_BUILD}`;
function assetsFor() {
    if (IS_WIN && process.arch === 'x64') {
        return {
            base: GGML_BASE,
            files: [
                `llama-${PINNED_BUILD}-bin-win-${CUDA_TAG}-x64.zip`,
                `cudart-llama-bin-win-${CUDA_TAG}-x64.zip`,   // CUDA runtime DLLs
            ],
        };
    }
    if (process.platform === 'linux' && process.arch === 'arm64') {
        return {
            base: OUR_BASE,
            // Self-contained: llama-server + the CUDA runtime .so it links, RPATH
            // $ORIGIN — no toolkit assumed on the box. tar.gz because `unzip` is
            // not guaranteed on a fresh DGX OS; tar always is.
            files: [`llama-${PINNED_BUILD}-bin-linux-cuda-arm64.tar.gz`],
        };
    }
    return null;
}

// Whether this platform can get llama-server WITHOUT operator work: a prebuilt
// asset exists to download. When false (and no binDir), `lol up` must fall back
// to the Ollama engine instead of dying — a farm that refuses to start because an
// optional accelerator is unavailable is what took the DGX Spark fleet box down.
function supported() {
    return assetsFor() !== null;
}

function installedBuild() {
    try { return fs.readFileSync(BUILD_FILE, 'utf8').trim(); } catch { return null; }
}

function installed(binDirOverride) {
    const bin = binDirOverride ? path.join(binDirOverride, IS_WIN ? 'llama-server.exe' : 'llama-server') : serverBin();
    return fs.existsSync(bin);
}

// Extract an archive using whatever the platform ships — no archive dependency,
// matching the rest of the farm's zero-extra-deps posture. tar.gz is the linux
// format (tar is always present; unzip is not); zip is the Windows one.
function extract(archivePath, destDir) {
    fs.mkdirSync(destDir, { recursive: true });
    if (/\.tar\.gz$/i.test(archivePath)) {
        execFileSync('tar', ['xzf', archivePath, '-C', destDir], { stdio: 'ignore' });
        return;
    }
    if (IS_WIN) {
        execFileSync('powershell', [
            '-NoProfile', '-NonInteractive', '-Command',
            `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destDir}' -Force`,
        ], { stdio: 'ignore', windowsHide: true });
    } else {
        execFileSync('unzip', ['-oq', archivePath, '-d', destDir], { stdio: 'ignore' });
    }
}

// Download + extract the pinned llama.cpp build. Idempotent: a matching
// .installed-build marker short-circuits it.
async function ensureLlamacpp(onProgress = () => {}) {
    if (installed() && installedBuild() === PINNED_BUILD) {
        return { ok: true, cached: true, binDir: BIN_DIR };
    }
    const assets = assetsFor();
    if (!assets) {
        return {
            ok: false,
            message: `No prebuilt llama.cpp for ${process.platform}/${process.arch}. ` +
                     `Install llama.cpp yourself and set llamacpp.binDir to the folder holding llama-server.`,
        };
    }
    fs.mkdirSync(ROOT, { recursive: true });

    for (const asset of assets.files) {
        onProgress(`fetching ${asset}`, 0);
        // Every asset extracts into the SAME bin dir: on Windows the cudart zip
        // carries the CUDA DLLs llama-server.exe loads from alongside itself; the
        // linux tarball is already self-contained.
        const got = await downloadGguf(`${assets.base}/${asset}`, (pct) => onProgress(asset, pct));
        extract(got.path, BIN_DIR);
    }
    // tar -C preserves modes, but belt-and-braces on the one bit that matters.
    if (!IS_WIN) { try { fs.chmodSync(serverBin(), 0o755); } catch { /* missing → caught below */ } }
    if (!installed()) {
        return { ok: false, message: `Extracted ${assets.files.join(' + ')} but ${serverBin()} is missing.` };
    }
    fs.writeFileSync(BUILD_FILE, PINNED_BUILD, 'utf8');
    return { ok: true, cached: false, binDir: BIN_DIR };
}

// Build the llama-server argv from config. This is where the measured recipe lives.
function argsFor(config, modelPath, mmprojPath) {
    const c = config.llamacpp;
    const args = [
        '--model', modelPath,
        '--alias', c.alias || 'assistant',
        '--host', c.host,
        '--port', String(c.port),
        // contextResolved is set by `lol up` before spawn ('auto' → the computed
        // max, numbers → clamped-if-needed); the raw config value may be 'auto'.
        '--ctx-size', String(c.contextResolved ?? c.contextLength),
        '--n-gpu-layers', String(c.ngl),
        '--parallel', String(c.parallel),
        '--jinja',        // use the GGUF's embedded chat template
        '--no-webui',     // LiteLLM fronts it; nothing should hit it directly
        '--metrics',      // Prometheus /metrics — the farm's performance monitor reads it
    ];
    // Flash attention: required for KV-cache quantization, and worth a large TTFT
    // improvement on its own (0.55s -> 0.22s measured on a 4070 Ti).
    if (c.flashAttention) args.push('-fa', '1');
    // Quantized KV is what makes an MTP-capable quant FIT on 12 GB. Without it
    // UD-Q2_K_XL needs ~11 GB and spills.
    if (c.kvCacheType && c.kvCacheType !== 'f16') {
        args.push('--cache-type-k', c.kvCacheType, '--cache-type-v', c.kvCacheType);
    }
    // Built-in NextN/MTP head. Only works on quants that still HAVE it — everything
    // at or above UD-Q2_K_XL. On a stripped quant llama-server exits with
    // "model doesn't contain MTP layers" rather than silently running slow, which is
    // the better failure and why we do not paper over it.
    if (c.mtp) args.push('--spec-type', 'draft-mtp', '--spec-draft-n-max', String(c.draftNMax));
    if (mmprojPath) args.push('--mmproj', mmprojPath);
    if (Array.isArray(c.extraArgs)) args.push(...c.extraArgs);
    return args;
}

// Fetch the model (and optional vision projector) named in the config, caching to
// farm/.models/. Returns absolute paths.
// Sharded GGUF: big models ship split as `name-00001-of-0000N.gguf`. llama-server
// loads shard 1 and finds the siblings in the same directory by itself — no merge
// step — so "ensure the model" for a split URL means: normalize ANY pasted shard
// URL to the full set, download every shard, and hand back shard 1's path.
// (Ollama's registry refuses sharded HF repos outright, which is why the library
// is the path that can actually serve these.)
const SHARD_RX = /-(\d{5})-of-(\d{5})\.gguf$/i;

// All sibling URLs (1..N) for a sharded .gguf URL, or null for a single file.
function shardUrls(url) {
    const m = String(url || '').match(SHARD_RX);
    if (!m) return null;
    const count = parseInt(m[2], 10);
    if (!count || count > 99) return null;
    return Array.from({ length: count }, (_, i) =>
        String(url).replace(SHARD_RX, `-${String(i + 1).padStart(5, '0')}-of-${m[2]}.gguf`));
}

// Shard 1's URL for any pasted part; single-file URLs pass through.
function normalizeModelUrl(url) {
    const parts = shardUrls(url);
    return parts ? parts[0] : url;
}

// The TRUE weights size on disk: a split model's shard 1 can be a few MB of
// metadata while the real tensors sit in its siblings — statting only the path
// llama-server is pointed at would wreck the VRAM budget.
function weightsBytesFor(modelPath) {
    let total = 0;
    try { total = fs.statSync(modelPath).size; } catch { return 0; }
    const base = path.basename(modelPath);
    const m = base.match(SHARD_RX);
    if (!m) return total;
    const count = parseInt(m[2], 10);
    for (let i = 1; i <= count; i++) {
        const sib = path.join(path.dirname(modelPath), base.replace(SHARD_RX, `-${String(i).padStart(5, '0')}-of-${m[2]}.gguf`));
        if (sib === modelPath) continue;
        try { total += fs.statSync(sib).size; } catch { /* missing shard — the load will say so */ }
    }
    return total;
}

async function ensureModel(config, onProgress = () => {}) {
    const c = config.llamacpp;
    if (!c.model) return { ok: false, message: 'llamacpp.model is not set (an https URL to a .gguf).' };
    const parts = shardUrls(c.model);
    let model;
    if (parts) {
        let first = null;
        let allCached = true;
        for (let i = 0; i < parts.length; i++) {
            const got = await downloadGguf(parts[i], (pct) => onProgress(`model part ${i + 1}/${parts.length}`, pct));
            if (i === 0) first = got;
            if (!got.cached) allCached = false;
        }
        model = { path: first.path, cached: allCached };
    } else {
        model = await downloadGguf(c.model, (pct) => onProgress('model', pct));
    }
    let mmproj = null;
    if (c.mmproj) mmproj = (await downloadGguf(c.mmproj, (pct) => onProgress('mmproj', pct))).path;
    return { ok: true, modelPath: model.path, mmprojPath: mmproj, cached: model.cached };
}

function spawnLlamacpp(config, modelPath, mmprojPath, binDirOverride) {
    const bin = binDirOverride
        ? path.join(binDirOverride, IS_WIN ? 'llama-server.exe' : 'llama-server')
        : serverBin();
    const child = spawn(bin, argsFor(config, modelPath, mmprojPath), {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env },
    });
    child.unref?.();
    return child;
}

function get(url, timeoutMs = 4000) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: timeoutMs }, (res) => {
            let b = '';
            res.on('data', (c) => { b += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve(null));
    });
}

async function llamacppAlive(port, timeoutMs = 4000) {
    const r = await get(`http://127.0.0.1:${port}/health`, timeoutMs);
    return !!(r && r.status === 200 && /"ok"/.test(r.body));
}

// Loading a 9 GB model onto a GPU takes a while; poll rather than guess.
// `isDead` (optional) short-circuits the wait: a llama-server that EXITED in its
// first second (mtp on a stripped quant, bad argv) used to still burn the full
// 5-minute timeout before the caller could roll back — in the Farm app that read
// as a hang.
async function waitForLlamacpp(port, timeoutMs = 300000, isDead = () => false) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (isDead()) return false;
        if (await llamacppAlive(port, 3000)) return true;
        await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
}

// Scrape llama-server's /metrics (enabled via --metrics in argsFor). Returns the
// parsed { name: value } map, or null when the server is down/not serving them.
async function fetchMetrics(port, timeoutMs = 3000) {
    const r = await get(`http://127.0.0.1:${port}/metrics`, timeoutMs);
    if (!r || r.status !== 200) return null;
    return require('./perf').parsePrometheus(r.body);
}

// The OpenAI base URL LiteLLM should point at.
function baseUrl(config) {
    const host = config.llamacpp.host === '0.0.0.0' ? '127.0.0.1' : config.llamacpp.host;
    return `http://${host}:${config.llamacpp.port}/v1`;
}

module.exports = {
    extract,   // exported for the extraction smoke test — the zipPath regression shipped because nothing exercised this
    PINNED_BUILD, ROOT, BIN_DIR,
    ensureLlamacpp, ensureModel, spawnLlamacpp, waitForLlamacpp, llamacppAlive, fetchMetrics, supported,
    argsFor, baseUrl, installed, installedBuild, serverBin,
    shardUrls, normalizeModelUrl, weightsBytesFor,
};
