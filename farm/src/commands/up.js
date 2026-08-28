// `lol up` (alias `lol serve`) — bring the farm online from lol.config.json.
//
// Steps: ensure each Ollama host is reachable → pull configured models →
// generate the LiteLLM config.yaml → start + health-wait the proxy → (M3) start
// the discovery beacon → supervise in the foreground until Ctrl-C.
//
// Runs in the foreground and writes .lol-runtime.json so `lol status` / `lol down`
// work from another shell.

const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const log = require('../log');
const ollama = require('../ollama');
const llamacpp = require('../llamacpp');
const proxyApi = require('../proxy');
const { loadConfig } = require('../config');
const { writeLitellmConfig, servedEntries } = require('../litellm');
const { buildSnapshot, backendInfo } = require('../snapshot');
const { patchSection, patchConfigFile } = require('../configFile');
const { detectHardware, gpuLiveStats } = require('../systemInfo');
const perfMod = require('../perf');
const ggufMod = require('../gguf');
const fsMod = require('fs');
const pathMod = require('path');
const { DiscoveryBeacon } = require('../beacon');
const { PeerListener } = require('../peerListener');
const { selectModels } = require('../modelPicker');
const { makeServices, pluginsSummary } = require('../plugins/registry');
const { farmId } = require('../identity');
const { startSelfServer } = require('../selfServer');
const {
    readRuntime, writeRuntime, clearRuntime, isAlive, killTree, spawnLitellm,
} = require('../proc');

const LOCAL_RX = /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i;
// Admin-input validation for the model-library routes.
const URL_RX = /^https?:\/\/\S+$/i;
const GGUF_URL_RX = /\.gguf(\?|$)/i;
const GGUF_EXT_RX = /\.gguf$/i;
const NAME_BAD_RX = /[^\w .\-+:]/;   // the advertised model name goes into a URL path and a picker

function isLocalHost(baseUrl) {
    try { return LOCAL_RX.test(new URL(baseUrl).hostname); } catch { return false; }
}

// The vision model the OCR service drives: an explicit config.ocr.model wins; else
// the served DEFAULT model if it's vision-capable; else any served vision model;
// else the default (so it at least runs — a text-only model just OCRs poorly). This
// is the real Ollama tag (`underlying`), since Ollama-OCR hits raw Ollama, not the
// alias-fronted proxy.
function resolveOcrModel(config) {
    if (config.ocr.model) return config.ocr.model;
    const entries = servedEntries(config);
    const pick = entries.find((e) => e.isDefault && e.vision)
        || entries.find((e) => e.vision)
        || entries.find((e) => e.isDefault)
        || entries[0];
    return pick ? pick.underlying : (config.models[0] && config.models[0].id);
}

// Spawn a local `ollama serve` with the configured concurrency env. Returns the
// child pid, or null if it couldn't be started. Only used when a LOCAL host is
// down — we never touch a remote box or an already-running local Ollama.
function spawnLocalOllama(config, baseUrl) {
    const env = {
        OLLAMA_NUM_PARALLEL: String(config.ollama.numParallel),
        OLLAMA_MAX_LOADED_MODELS: String(config.ollama.maxLoadedModels),
        OLLAMA_FLASH_ATTENTION: config.ollama.flashAttention ? '1' : '0',
        // Keep-warm policy depends on WHICH engine serves. Ollama engine: the
        // configured keepAlive ('-1' = forever — right for a dedicated box). But when
        // llama.cpp is the engine, the only Ollama user is the OCR plugin, and a
        // vision model pinned forever ('-1') next to a resident llama-server is how a
        // 12 GB card ends up paging every token. 5 minutes: hot across a document
        // batch, gone before it starves chat.
        OLLAMA_KEEP_ALIVE: config.llamacpp.enabled ? '5m' : config.ollama.keepAlive,
        // Context window big enough for whole-document chat — see config.contextLength.
        // 'auto' resolves AFTER Ollama is up (resolveOllamaContext probes the real
        // load), so the env seed is the proven floor; the resolved value rides
        // num_ctx on every routed request, which is what governs served context.
        OLLAMA_CONTEXT_LENGTH: String(typeof config.ollama.contextLength === 'number' ? config.ollama.contextLength : 16384),
    };
    try {
        const u = new URL(baseUrl);
        env.OLLAMA_HOST = `${u.hostname}:${u.port || 11434}`;
        const child = spawn('ollama', ['serve'], {
            shell: process.platform === 'win32',
            windowsHide: true,
            detached: process.platform !== 'win32',
            env: { ...process.env, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout.on('data', log.childPrefix('ollama'));
        child.stderr.on('data', log.childPrefix('ollama'));
        child.on('error', () => {});
        return child.pid || null;
    } catch {
        return null;
    }
}

async function ensureOllama(config) {
    const hosts = config.ollama.hosts.map(ollama.normalizeHost);
    const reachable = [];
    const spawnedPids = [];
    const spawnedHosts = new Set();   // exactly which local hosts THIS run started

    for (const host of hosts) {
        let v = await ollama.version(host);
        if (!v && isLocalHost(host)) {
            log.step(`Ollama not up on ${host} — starting it locally …`);
            const pid = spawnLocalOllama(config, host);
            if (pid) {
                spawnedPids.push(pid);
                spawnedHosts.add(host);
                // Wait up to ~15s for it to answer.
                for (let i = 0; i < 20 && !v; i++) {
                    await new Promise((r) => setTimeout(r, 750));
                    v = await ollama.version(host);
                }
            }
        }
        if (v) { reachable.push(host); log.ok(`Ollama ${log.paint.bold(v)} @ ${host}`); }
        else { log.warn(`Ollama unreachable @ ${host} — clients won't be routed there.`); }
    }

    if (!reachable.length) {
        log.err('No reachable Ollama host. Start Ollama (https://ollama.com) and check ollama.hosts.');
        return null;
    }

    // Concurrency env only takes effect when Ollama STARTS. If a host was already
    // up, we can't change it — surface the recommended values instead of lying.
    // Per-host: spawning ONE local Ollama must not mute the advice for the OTHER
    // hosts that were already running with whatever env they were started with.
    const alreadyUp = reachable.filter((h) => !spawnedHosts.has(h));
    if (alreadyUp.length) {
        log.info(
            `Note: set on each Ollama service to apply concurrency/keep-warm/context — ` +
            `OLLAMA_NUM_PARALLEL=${config.ollama.numParallel} ` +
            `OLLAMA_MAX_LOADED_MODELS=${config.ollama.maxLoadedModels} ` +
            `OLLAMA_FLASH_ATTENTION=${config.ollama.flashAttention ? 1 : 0} ` +
            `OLLAMA_KEEP_ALIVE=${config.ollama.keepAlive} ` +
            `OLLAMA_CONTEXT_LENGTH=${typeof config.ollama.contextLength === 'number' ? config.ollama.contextLength : 16384}`
        );
    }
    return { reachable, spawnedPids };
}

async function pullMissing(config, reachable) {
    for (const host of reachable) {
        const present = await ollama.listModels(host);
        // Served models AND preinstalled ones: `preinstall` must be on disk so the
        // admin can start it from the panel without a download, but it is NOT served
        // (no LiteLLM deployment, absent from the snapshot) so no client can select it.
        for (const m of config.models.concat(config.preinstall || [])) {
            const label = (() => { try { return new URL(host).host; } catch { return host; } })();
            // What actually has to be downloaded: the upstream `source` when the
            // model is derived, otherwise the id itself.
            const upstream = m.source || m.id;
            if (!ollama.hasModel(present, upstream)) {
                log.step(`${label}: pulling ${log.paint.bold(upstream)} (first run can be slow) …`);
                try {
                    let last = '';
                    await ollama.pullModel(host, upstream, (s) => {
                        if (s !== last) { last = s; process.stdout.write(`\r${log.paint.grey(`[${label}]`)} ${s}            `); }
                    });
                    process.stdout.write('\n');
                    log.ok(`${label}: ${upstream} ready.`);
                } catch (e) {
                    process.stdout.write('\n');
                    log.warn(`${label}: could not pull ${upstream} — ${e.message}`);
                    continue;
                }
            }

            // Derived models are (re)created on EVERY `lol up`, even when they already
            // exist, so num_ctx tracks config.ollama.contextLength instead of going
            // stale after the operator changes it. Creating from an already-present
            // source is a manifest write — cheap, no re-download.
            if (m.source) {
                const params = Object.assign({ num_ctx: config.ollama.contextLength }, m.params || {});
                const shown = Object.entries(params).map(([k, v]) => `${k}=${v}`).join(' ');

                // A separate draft/MTP module needs the CLI and a local file path, so it
                // is only attachable on a local host (see ollama.createModelWithDraft).
                let draftFile = null;
                if (m.draft && isLocalHost(host)) {
                    try {
                        const got = await ollama.downloadDraft(m.draft, (pct) => {
                            process.stdout.write(`\r${log.paint.grey(`[${label}]`)} draft module ${pct}%   `);
                        });
                        if (!got.cached) process.stdout.write('\n');
                        draftFile = got.path;
                        log.ok(`${label}: draft module ${got.cached ? 'cached' : 'downloaded'} ${log.paint.grey(got.path)}`);
                    } catch (e) {
                        process.stdout.write('\n');
                        log.warn(`${label}: draft module download failed — ${e.message}. Continuing without speculative decoding.`);
                    }
                } else if (m.draft) {
                    log.warn(`${label}: remote host — a draft module cannot be attached (Ollama's REST create drops it). Serving without speculative decoding.`);
                }

                try {
                    if (draftFile) {
                        await ollama.createModelWithDraft(m.id, m.source, draftFile, params);
                        log.ok(`${label}: ${log.paint.bold(m.id)} derived from ${m.source} ${log.paint.grey(`(+draft, ${shown})`)}`);
                    } else {
                        await ollama.createModel(host, m.id, m.source, params);
                        log.ok(`${label}: ${log.paint.bold(m.id)} derived from ${m.source} ${log.paint.grey(`(${shown})`)}`);
                    }
                } catch (e) {
                    log.warn(`${label}: could not derive ${m.id} from ${m.source} — ${e.message}`);
                    log.warn(`${label}: ${log.paint.bold('MTP/context parameters are NOT applied')} — expect roughly half the expected throughput.`);
                }
            }
        }
    }
}

// Coordinator mode: listen briefly for peer farms on the LAN (beacons + a unicast
// sweep) and return them as LiteLLM peer deployments. Static at boot — the fleet's
// membership is captured once here; a box added later is picked up by restarting
// the coordinator. Self is excluded by farm id.
async function discoverPeers(config) {
    const listener = new PeerListener({
        group: config.beacon.group,
        port: config.beacon.port,
        httpPort: config.beacon.httpPort,
        selfId: farmId(),
    }).start();
    log.step('Coordinator: discovering peer farms on the LAN …');
    const windowMs = Math.max(6000, config.beacon.intervalSec * 2000 + 1500);
    await Promise.all([
        new Promise((r) => setTimeout(r, windowMs)),
        listener.sweep().catch(() => {}),      // for broadcast-blocked LANs
    ]);
    const skippedKeyed = listener.getPeers().filter((p) => p.snap.requiresKey);
    if (skippedKeyed.length) {
        // The router would send every request with a placeholder key and the peer
        // would reject each one — a permanently failing deployment that just adds
        // retry latency. Until a fleet key exists, a passworded farm stays its own
        // island and the coordinator says so instead of shipping a broken pool.
        log.warn(`Coordinator: skipping password-protected peer(s): ${skippedKeyed.map((p) => p.snap.name || p.host).join(', ')}.`);
    }
    const peers = listener.getPeers()
        .filter((p) => p.snap.healthy !== false && !p.snap.coordinator && !p.snap.requiresKey)
        .map((p) => ({
            openaiBaseUrl: p.snap.openaiBaseUrl,
            models: p.snap.models,
            name: p.snap.name,
            host: p.host,
        }));
    listener.stop();
    return peers;
}

// --alias <name> / --alias=name overrides the stable model alias for this run;
// --no-alias disables it. undefined = not specified (keep config.modelAlias).
function parseAliasFlag(args) {
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--no-alias') return null;
        if (a === '--alias') { const v = args[i + 1]; if (v && !v.startsWith('-')) return v.trim(); }
        else if (a.startsWith('--alias=')) return a.slice('--alias='.length).trim();
    }
    return undefined;
}

async function run(args) {
    let config, configPath;
    try { ({ config, path: configPath } = loadConfig()); }
    catch (e) { log.err(e.message); return 1; }
    const coordinator = (args || []).includes('--coordinator') || config.coordinator === true;
    const aliasArg = parseAliasFlag(args || []);
    if (aliasArg !== undefined) config.modelAlias = aliasArg;
    // Web search: config is the default, per-run flags override.
    if ((args || []).includes('--websearch')) config.websearch.enabled = true;
    if ((args || []).includes('--no-websearch')) config.websearch.enabled = false;
    if ((args || []).includes('--tts')) config.tts.enabled = true;
    if ((args || []).includes('--no-tts')) config.tts.enabled = false;
    if ((args || []).includes('--ocr')) config.ocr.enabled = true;
    if ((args || []).includes('--no-ocr')) config.ocr.enabled = false;
    // Admin control token (start/stop models, toggle plugins from the /lol/admin page).
    // Ephemeral per run when unset — printed in the banner so the operator can paste it.
    if (!config.admin.token) config.admin.token = crypto.randomBytes(24).toString('hex');
    const adminToken = config.admin.token;

    // Refuse to double-start.
    const existing = readRuntime();
    if (existing && isAlive(existing.litellmPid)) {
        log.err(`Farm already running (LiteLLM pid ${existing.litellmPid}, ${existing.endpoint}). Run \`lol down\` first.`);
        return 1;
    }
    if (existing) {
        // Stale run (its LiteLLM is gone). Reap any of ITS children that outlived it: the
        // SearXNG/Kokoro/OCR plugins spawn detached (their own process group), so a crash or
        // hard-kill of the previous `lol up` can orphan them still holding their ports —
        // which would then block THIS run's plugins from binding. Best-effort per pid.
        for (const pid of [existing.searxngPid, existing.kokoroPid, existing.extractPid, existing.llamacppPid, ...(existing.ollamaPids || [])]) {
            if (pid && isAlive(pid)) { try { await killTree(pid); } catch { /* already gone */ } }
        }
        clearRuntime();
    }

    log.info(`Bringing up ${log.paint.bold(config.name)} …`);

    // 0b. Detect hardware FIRST — the llama.cpp VRAM budget needs it before spawn
    //     (it used to be detected only when the snapshot was built, long after).
    const hw = await detectHardware();

    // 0c. Can this platform run the llama.cpp engine at all? No prebuilt asset and
    //     no binDir means the answer is no (linux-arm64 — the DGX Spark — today), and
    //     the farm must FALL BACK to the Ollama engine instead of exiting: this exact
    //     hard-exit is what made the DGX box "not launch at all". In-memory only —
    //     the operator's config keeps llamacpp.enabled, so a later build (or a binDir)
    //     re-enables it without anyone re-editing anything.
    let llamacppBootError = null;
    if (config.llamacpp.enabled && !config.llamacpp.binDir && !llamacpp.installed() && !llamacpp.supported()) {
        llamacppBootError = `No prebuilt llama.cpp for ${process.platform}/${process.arch} — serving with Ollama. ` +
            'Install llama.cpp yourself and set llamacpp.binDir to use the llama.cpp engine.';
        log.warn(llamacppBootError);
        config.llamacpp.enabled = false;
    }

    // 1. Ollama
    const oll = await ensureOllama(config);
    if (!oll) return 1;

    // 1b. Choose which installed model(s) to serve (interactive picker, or
    //     --model / --no-pick / non-TTY → the configured catalog). Drives THIS run.
    // The interactive picker chooses what OLLAMA serves. With the llama.cpp engine
    // on, the catalog is standby inventory (nothing in it is routed), so prompting
    // "which models to serve" would promise something the run will not do.
    if (!config.llamacpp.enabled) {
        config.models = await selectModels(config, oll.reachable, args || []);
    }

    // 2. Models — pull any chosen model a host is missing (no-op for picked ones).
    await pullMissing(config, oll.reachable);

    let llamacppChild = null;
    // Crash supervision is LATE-BOUND: the exit handler can fire during boot
    // (llama-server dies in its first second — the mtp-on-stripped-quant case),
    // before serialize/liveHealth exist. Until fn is assigned (end of the control
    // block), an unexpected exit is handled by the boot path itself: waitForLlamacpp
    // sees exited=true and fails fast into the normal rollback/fallback.
    const engineDownBox = { fn: null, markUp: null };
    // The .gguf actually loaded (set by startLlamacpp) — fs.statSync on it is the
    // honest weights size the VRAM budget wants.
    let lastModelPath = null;

    // VRAM budget for the CURRENT llama.cpp shape (or a would-be context size).
    // null when it cannot be computed — no GPU detected, or weights not on disk yet.
    // On unified-memory boxes (DGX Spark) detectHardware reports the RAM pool, so
    // the budget is generous there rather than wrongly restrictive.
    // GGUF metadata (native context max + KV geometry), cached per file — a parse
    // is ~1 ms but computeFit runs on every adminState poll.
    let metaCache = { path: null, meta: null };
    function modelMeta(mp) {
        if (metaCache.path !== mp) metaCache = { path: mp, meta: ggufMod.readGgufMeta(mp) };
        return metaCache.meta;
    }

    function computeFit(atContext) {
        try {
            const mp = (lastModelPath && fsMod.existsSync(lastModelPath))
                ? lastModelPath
                : (config.llamacpp.model ? ollama.ggufPathFor(config.llamacpp.model) : null);
            if (!mp || !fsMod.existsSync(mp)) return null;
            const meta = modelMeta(mp);
            const weightsGb = fsMod.statSync(mp).size / 1e9;
            let mmprojGb = 0;
            if (config.llamacpp.mmproj) {
                const pp = ollama.ggufPathFor(config.llamacpp.mmproj);
                mmprojGb = (pp && fsMod.existsSync(pp)) ? fsMod.statSync(pp).size / 1e9 : 0.8;
            }
            const cfgCtx = config.llamacpp.contextLength;
            const at = atContext
                ?? config.llamacpp.contextResolved
                ?? (typeof cfgCtx === 'number' ? cfgCtx : 16384);
            const nativeMax = (meta && meta.contextLength) || null;
            const budget = perfMod.fitBudget({
                vramGb: hw && hw.vramGb, weightsGb, mmprojGb,
                kvCacheType: config.llamacpp.kvCacheType,
                contextLength: at,
                // The model's own KV geometry when the header carries it — exact,
                // where the table is one measured family.
                kvRate: ggufMod.kvGbPer16k(meta, config.llamacpp.kvCacheType),
            });
            // "Max that fits" is also capped by what the model was TRAINED at —
            // llama-server will run past n_ctx_train, silently degrading.
            const maxContext = budget.maxContext != null && nativeMax
                ? Math.min(budget.maxContext, nativeMax)
                : (budget.maxContext ?? nativeMax);
            return {
                ...budget,
                maxContext,
                nativeMax,
                vramGb: (hw && hw.vramGb) || null,
                weightsGb: Math.round(weightsGb * 10) / 10,
                kvCacheType: config.llamacpp.kvCacheType,
            };
        } catch { return null; }
    }

    // ---- Ollama-engine context auto-sizing --------------------------------
    // The numeric context the Ollama engine serves RIGHT NOW (resolved 'auto', or
    // the pinned number). Falls back to 16384 — the measured-safe default — until
    // 'auto' has resolved, and during a crash-fallback, where probing would delay
    // recovery (the next full boot probes properly).
    function ollamaCtxNum() {
        return config.ollama.contextResolved
            ?? (typeof config.ollama.contextLength === 'number' ? config.ollama.contextLength : 16384);
    }

    function dropOllamaCtxCache() {
        try { fsMod.unlinkSync(pathMod.join(ollama.modelsDir(), 'ollama-ctx.json')); } catch { /* absent */ }
    }

    // Resolve config.ollama.contextLength === 'auto' to the LARGEST num_ctx that
    // keeps the default model fully in VRAM on this box. llama.cpp gets this from
    // GGUF math (computeFit); here that math is unreliable — sliding-window
    // architectures (Gemma) make the naive KV estimate several times too high — so
    // the farm MEASURES instead: load the model at a VRAM-tiered candidate, read
    // /api/ps, and step down when size_vram < size (layers landed in system RAM =
    // the "few tok/s" AN-VR-01 failure). The verdict is cached per (model, VRAM,
    // parallel) next to the weights, so the probe cost — one or two model loads —
    // is paid once per box, not per boot. The probe doubles as the warm-up: it
    // leaves the model loaded at the size that will serve.
    async function resolveOllamaContext(progress = () => {}) {
        const cl = config.ollama.contextLength;
        if (typeof cl === 'number') { config.ollama.contextResolved = cl; return cl; }
        const def = (config.models.find((m) => m.default) || config.models[0] || {}).id;
        const host = (oll.reachable || []).filter(isLocalHost)[0] || (oll.reachable || [])[0] || null;
        if (!def || !host) { config.ollama.contextResolved = 16384; return 16384; }
        const vram = (hw && hw.vramGb) || null;
        const cacheFile = pathMod.join(ollama.modelsDir(), 'ollama-ctx.json');
        const cacheKey = `${def}|${vram ?? '?'}|${config.ollama.numParallel}`;
        let cache = {};
        try { cache = JSON.parse(fsMod.readFileSync(cacheFile, 'utf8')) || {}; } catch { /* first probe */ }
        if (typeof cache[cacheKey] === 'number') {
            config.ollama.contextResolved = cache[cacheKey];
            log.ok(`Context: auto → ${log.paint.bold(String(cache[cacheKey]))} tokens ${log.paint.grey(`(cached probe: ${def} on this box)`)}`);
            return cache[cacheKey];
        }
        const meta = await ollama.showModel(host, def);
        const native = (meta && meta.contextLength) || null;
        // Load the model at a given num_ctx and report Ollama's REAL memory verdict.
        const psSizeAt = async (ctx) => {
            const warmed = await ollama.warmModel(host, def, config.ollama.keepAlive, ctx, 300000);
            if (!warmed) return null;
            const ps = await ollama.psModels(host);
            const bare = def.split(':')[0];
            const entry = ps.find((m) => m.name === def || m.name === `${def}:latest` || m.name.split(':')[0] === bare);
            return entry && entry.size > 0 ? entry : null;
        };
        const fits = (p) => p != null && p.sizeVram >= p.size;
        const step = (n) => Math.floor(n / 4096) * 4096;
        // Two-point measurement: the model's REAL memory at 16k and 32k gives the
        // per-token KV slope (sliding-window layers are saturated well before 16k,
        // so the tail is linear), and the largest window inside the VRAM budget
        // follows. A verify-load at the target catches anything the line missed —
        // Ollama's own placement is always the referee, never the arithmetic.
        // Ceiling 262144 (panel bound); ~8% VRAM headroom for the desktop.
        const cap = Math.max(16384, Math.min(native || 262144, 262144));
        const budget = vram != null ? (vram - Math.max(1, vram * 0.08)) * 1e9 : null;
        let resolved = 16384;
        progress('measuring the model at 16k', null);
        const p1 = await psSizeAt(16384);
        if (!fits(p1)) {
            // Even the shipped floor spills here (big model, small card) — walk down.
            for (const c of [8192, 4096]) {
                progress(`measuring the model at ${c}`, null);
                if (fits(await psSizeAt(c))) { resolved = c; break; }
                resolved = 4096;
            }
        } else if (cap > 16384) {
            let target = null;
            if (budget != null) {
                progress('measuring the model at 32k', null);
                const p2 = await psSizeAt(32768);
                if (fits(p2)) {
                    const rate = Math.max(0, (p2.size - p1.size) / 16384);   // bytes per token
                    const base = p1.size - rate * 16384;
                    target = rate > 0 ? step((budget - base) / rate) : cap;
                    target = Math.max(16384, Math.min(cap, target));
                    if (target === 32768) { target = null; resolved = 32768; }
                } else {
                    target = null;                                          // 32k spills → keep 16k
                }
            } else {
                target = cap;   // unified/unknown memory: aim at the cap, let the verify decide
            }
            if (target != null && target > 16384) {
                progress(`verifying a ${target}-token window`, null);
                if (fits(await psSizeAt(target))) resolved = target;
                else {
                    // The line missed — one conservative halving, then the floor.
                    const half = Math.max(16384, step(target / 2));
                    if (half > 16384) {
                        progress(`verifying a ${half}-token window`, null);
                        if (fits(await psSizeAt(half))) resolved = half;
                    }
                }
            }
        }
        config.ollama.contextResolved = resolved;
        cache[cacheKey] = resolved;
        try { fsMod.writeFileSync(cacheFile, JSON.stringify(cache, null, 2)); } catch { /* best-effort cache */ }
        const why = [
            native ? `model max ${native}` : 'model max unknown',
            vram ? `probed on ${vram} GB` : 'probed',
        ].join(', ');
        log.ok(`Context: auto → ${log.paint.bold(String(resolved))} tokens ${log.paint.grey(`(${why})`)}`);
        // If the fitting candidate wasn't the last thing loaded, re-warm at the
        // size that will actually serve (fire-and-forget).
        ollama.warmModel(host, def, config.ollama.keepAlive, resolved).catch(() => {});
        return resolved;
    }

    // Bring llama-server up for the CURRENT in-memory config: binaries, then weights,
    // then spawn + health-wait. Factored out of the boot path because every live change
    // that touches the model has to redo exactly this — switching backend, swapping the
    // .gguf, changing the slot count, renaming the advertised model — and llama-server
    // has no reload: its model, alias, context and slots are all argv.
    // Returns { ok, message } rather than exiting, so a live caller can roll back.
    async function startLlamacpp(onProgress = () => {}) {
        if (llamacppChild) return { ok: true, already: true };
        const binDir = config.llamacpp.binDir;
        // Fetching binaries or weights REJECTS on a bad URL / dead network rather than
        // returning — and this function's whole job is to hand callers a failure they
        // can roll back from. An escaping exception skipped the rollback in
        // setLlamacppModel and left the farm with no backend at all.
        let mdl;
        try {
            if (!binDir) {
                onProgress('llama.cpp binaries', null);
                const got = await llamacpp.ensureLlamacpp(onProgress);
                if (!got.ok) return { ok: false, message: got.message };
                if (!got.cached) log.ok(`llama.cpp ${llamacpp.PINNED_BUILD} installed.`);
            } else if (!llamacpp.installed(binDir)) {
                return { ok: false, message: `No llama-server in ${binDir}.` };
            }
            onProgress('model weights', null);
            mdl = await llamacpp.ensureModel(config, onProgress);
        } catch (e) {
            return { ok: false, message: `Could not fetch llama.cpp or its weights: ${(e && e.message) || e}` };
        }
        if (!mdl.ok) return { ok: false, message: mdl.message };
        lastModelPath = mdl.modelPath;

        // Resolve the context window BEFORE spawn — llama-server takes it as argv
        // and does not refuse a shape that overflows VRAM (Windows overcommits into
        // system RAM and the box "works" at a few tok/s; live case: 256k saved from
        // the panel onto a 12 GB card, 11.6/12 GB used at idle).
        //
        //   'auto' (the default) → the LARGEST context this box can hold:
        //     min(model native max, what fits VRAM), both read from the real files.
        //   a number → honored, clamped (and the clamp persisted) if it cannot fit.
        const fit = computeFit(16384);   // maxContext is independent of the request
        if (config.llamacpp.contextLength === 'auto') {
            let target = (fit && fit.maxContext) || 16384;
            target = Math.max(4096, target);
            config.llamacpp.contextResolved = target;
            const why = [
                fit && fit.nativeMax ? `model max ${fit.nativeMax}` : 'model max unknown',
                fit && fit.vramGb ? `budget for ${fit.vramGb} GB` : null,
            ].filter(Boolean).join(', ');
            log.ok(`Context: auto → ${log.paint.bold(String(target))} tokens ${log.paint.grey(`(${why})`)}`);
        } else {
            const target = config.llamacpp.contextLength;
            // A pinned number that overflows VRAM is HONORED, loudly (owner call
            // 2026-08-28: the admin may deliberately trade speed for window — the
            // boot used to clamp+persist, which silently undid that choice).
            if (fit && fit.maxContext != null && fit.maxContext >= 4096 && target > fit.maxContext) {
                log.warn(`Context ${target} needs ~${computeFit(target).needGb} GB — this GPU has ${fit.vramGb} GB. ` +
                    `Honoring it (explicitly configured), but part of the model will live in system RAM: expect a few tokens/second. ` +
                    `${fit.maxContext} is the largest that fits; "auto" picks it for you.`);
            }
            config.llamacpp.contextResolved = target;
        }
        const child = llamacpp.spawnLlamacpp(config, mdl.modelPath, mdl.mmprojPath, binDir);
        child.stdout.on('data', log.childPrefix('llama.cpp'));
        child.stderr.on('data', log.childPrefix('llama.cpp'));
        llamacppChild = child;
        // Crash supervision. The identity guard makes intentional stops silent:
        // stopLlamacpp nulls llamacppChild BEFORE killing, so by the time exit
        // fires the child is no longer "current". Anything else is a mid-run death
        // (OOM, driver reset) that used to leave LiteLLM routing every chat into a
        // dead :8081 while the beacon kept saying healthy.
        let exited = false;
        child.once('exit', (code) => {
            exited = true;
            if (llamacppChild !== child) return;   // superseded or stopped on purpose
            llamacppChild = null;
            if (engineDownBox.fn) engineDownBox.fn(code);
        });
        onProgress('loading onto the GPU', null);
        log.step(`llama.cpp serving ${log.paint.bold(config.llamacpp.alias)} on :${config.llamacpp.port} — loading …`);
        if (!(await llamacpp.waitForLlamacpp(config.llamacpp.port, 300000, () => exited))) {
            await stopLlamacpp();
            return {
                ok: false,
                message: 'llama.cpp did not become healthy. The usual cause is mtp:true on a quant whose '
                    + 'MTP head was stripped (anything under UD-Q2_K_XL) — it exits with "model doesn\'t '
                    + 'contain MTP layers". Use an MTP-capable quant or turn MTP off.',
            };
        }
        log.ok(`llama.cpp backend healthy on :${config.llamacpp.port} ${log.paint.grey(`(${config.llamacpp.kvCacheType} KV, MTP ${config.llamacpp.mtp ? 'on' : 'off'})`)}`);
        // liveHealth does not exist yet during BOOT (TDZ — this exact line crashed
        // the farm live); the box thunk is armed once it does. The liveHealth
        // literal itself seeds engineUp for the boot case.
        if (engineDownBox.markUp) engineDownBox.markUp();
        return { ok: true, modelPath: mdl.modelPath, cached: mdl.cached };
    }

    // A mid-run llama-server death: try ONE restart (transient driver hiccup);
    // if that fails or it dies again within 5 minutes, fall back to the Ollama
    // engine so the farm keeps serving — and in BOTH windows tell the fleet
    // immediately: engineUp flips snapshot.healthy so clients fail over instead
    // of erroring into a dead port. Deliberately not a job (no operator asked).
    let lastEngineRestart = 0;
    function onEngineDown(code) {
        if (stopping) return;
        log.err(`llama-server exited unexpectedly (code ${code}).`);
        liveHealth.engineUp = false;
        if (beacon) beacon.kick();
        const recent = Date.now() - lastEngineRestart < 5 * 60 * 1000;
        lastEngineRestart = Date.now();
        serialize(async () => {
            if (stopping || llamacppChild) return;     // already handled/replaced
            if (!recent) {
                log.step('Restarting llama-server …');
                const r = await startLlamacpp(() => {});
                if (r.ok) {
                    liveHealth.engineUp = true;
                    if (beacon) beacon.kick();
                    log.ok('llama-server recovered.');
                    return;
                }
                llamacppBootError = r.message;
            } else {
                llamacppBootError = 'llama-server crashed twice in 5 minutes.';
            }
            log.warn(`${llamacppBootError} Falling back to the OLLAMA engine.`);
            config.llamacpp.enabled = false;
            await stopLlamacpp();
            liveHealth.engineUp = null;                // no engine to be down now
            await restartProxy();
            if (beacon) beacon.kick();
        });
    }

    // Stop llama-server and WAIT for its port to actually free. The wait is the point:
    // killTree returns as soon as the signal is delivered, but llama-server holds
    // :8081 while it unmaps ~8 GB of weights, so an immediate respawn (which is what
    // every live model change does) would bind-fail and leave the farm with no backend.
    async function stopLlamacpp() {
        if (!llamacppChild) return;
        const pid = llamacppChild.pid;
        llamacppChild = null;
        if (pid) { try { await killTree(pid); } catch { /* already gone */ } }
        for (let i = 0; i < 60; i++) {
            if (!(await llamacpp.llamacppAlive(config.llamacpp.port, 1000))) return;
            await new Promise((r) => setTimeout(r, 250));
        }
        log.warn(`llama.cpp still answering on :${config.llamacpp.port} after 15s — the next start may fail to bind.`);
    }

    // 2b. llama.cpp backend (the default). Runs INSTEAD of Ollama for its alias —
    //     LiteLLM skips the Ollama deployments for that model_name — because it is the
    //     only way to get speculative decoding on a 12 GB card (see LlamacppSchema).
    //     The client is unaffected: llama-server is OpenAI-compatible behind LiteLLM.
    if (config.llamacpp.enabled) {
        const r = await startLlamacpp((what, pct) => {
            if (pct == null) log.step(`llama.cpp: ${what} …`);
            else process.stdout.write(`\r${log.paint.grey('[llama.cpp]')} ${what} ${pct}%   `);
        });
        process.stdout.write('');
        if (!r.ok) {
            // Do NOT exit. A farm that dies because its accelerator failed serves
            // nobody; one that falls back to Ollama serves everyone, slower, and
            // says why (the panel shows this reason on the Backend card). In-memory
            // only — the operator's config keeps llamacpp.enabled, so the next boot
            // retries (a transient download failure heals itself).
            llamacppBootError = r.message;
            log.err(`llama.cpp backend: ${r.message}`);
            log.warn('Falling back to the OLLAMA engine for this run.');
            config.llamacpp.enabled = false;
            await stopLlamacpp();
        }
    }

    // 2c. Ollama-engine context: with llama.cpp serving, no local Ollama is routed,
    //     so sizing would probe (and load a model) for nothing. When Ollama IS the
    //     engine — configured, unsupported platform, or boot fallback — resolve
    //     'auto' BEFORE the routing is generated so num_ctx carries the real number.
    if (!config.llamacpp.enabled) {
        await resolveOllamaContext((what) => log.step(`Context: ${what} …`));
    }

    // 3. (Coordinator) discover peer farms, then generate the LiteLLM config —
    //    routing is derived from local Ollama hosts + any aggregated peers.
    const peers = coordinator ? await discoverPeers(config) : [];
    if (coordinator) {
        if (peers.length) log.ok(`Coordinator: aggregating ${peers.length} peer farm(s) — ${peers.map((p) => p.name || p.host).join(', ')}`);
        else log.warn('Coordinator: no peer farms found — serving local only. Start the peers first, then re-run to include them.');
    }
    const yamlPath = writeLitellmConfig(config, undefined, peers);
    const backends = config.ollama.hosts.length + peers.length;
    log.ok(`Generated LiteLLM routing → ${log.paint.grey(yamlPath)} (${config.models.length} model × ${config.ollama.hosts.length} host${peers.length ? ` + ${peers.length} peer` : ''} deployments)`);
    const alias = (config.modelAlias || '').trim();
    if (alias) {
        const real = (config.models.find((m) => m.default) || config.models[0]).id;
        log.ok(`Model alias: clients see ${log.paint.bold(`"${alias}"`)} → ${log.paint.bold(real)} (switch the model anytime without breaking chats)`);
    }

    // 4. Start + health-wait the proxy.
    const baseUrl = `http://127.0.0.1:${config.proxy.port}`;
    log.step(`Starting LiteLLM proxy on ${config.proxy.host}:${config.proxy.port} …`);
    // `child` is a `let` so the admin control API can bounce the proxy in place
    // (restartProxy below) to change the served model set without a full `lol up`.
    let child = spawnLitellm(config, yamlPath);
    let restartingProxy = false;   // true while restartProxy() deliberately bounces LiteLLM
    const wireProxyIo = (c) => {
        c.stdout.on('data', log.childPrefix('litellm'));
        c.stderr.on('data', log.childPrefix('litellm'));
    };
    let spawnFailed = false;
    child.on('error', (e) => {
        spawnFailed = true;
        if (e.code === 'ENOENT') {
            log.err(`LiteLLM not found ('${config.litellm.command}'). Install it (pip install 'litellm[proxy]') or set litellm.command in lol.config.json.`);
        } else {
            log.err(`Failed to start LiteLLM: ${e.message}`);
        }
    });
    wireProxyIo(child);

    const up = await proxyApi.waitForProxy(baseUrl, { timeoutMs: 90000 });
    if (spawnFailed) return 1;
    if (!up) {
        log.err('LiteLLM did not become healthy in time. Check the [litellm] logs above.');
        await killTree(child.pid);
        return 1;
    }

    const served = await proxyApi.listProxyModels(baseUrl, config.proxy.masterKey);
    log.ok(`Proxy healthy — ${log.paint.bold('/v1/models')}: ${served.length ? served.join(', ') : '(none yet)'}`);

    // 4b. Farm-side plugins (web search / voice / OCR) — one shared instance each for the
    // whole LAN, spawned + health-waited here and advertised in the snapshot. All three run
    // through the plugin registry so boot, live toggling (control.setPlugin), the health
    // timer, and teardown share ONE path. Auxiliary: a failure warns and the farm still
    // comes up without that plugin. (Client-side plugins like Blender aren't here — the
    // farm only recommends them via config.recommendedClientPlugins.)
    const services = makeServices();
    const svcById = Object.fromEntries(services.map((s) => [s.id, s]));
    const pluginRuntime = { log, crypto, resolveOcrModel, isLocalHost, reachable: oll.reachable };
    for (const svc of services) {
        if (!svc.enabled(config)) continue;
        const res = await svc.start(config, pluginRuntime);
        if (res && res.level && res.message) log[res.level](res.message);
    }

    // 5. Discovery — UDP beacon + unicast /lol/self (both share ONE snapshot so
    // they can't drift). liveHealth is refreshed on a timer below. The plugin flags are
    // read from the service instances (bespoke keys kept for snapshot back-compat).
    const liveHealth = {
        proxyUp: true,
        hostsUp: oll.reachable.length,
        hostsTotal: config.ollama.hosts.length,
        loaded: [],
        coordinator,                     // advertise the role so clients prefer us
        deployments: backends,           // local hosts + aggregated peers
        searxngUp: svcById.websearch.up, // advertise searxngUrl so clients get web search
        ttsUp: svcById.tts.up,           // advertise ttsUrl so clients get neural voice
        extractUp: svcById.ocr.up,       // advertise extract{} so clients get document OCR
        extractKey: svcById.ocr.up ? svcById.ocr.ctx.key : null, // bearer OWUI's loader must send
        plugins: pluginsSummary(services, config), // generic map for the admin page + clients
        clientsConnected: 0,             // desktop clients heartbeating us (see onClientPing)
        host: hw,                        // static GPU/VRAM/RAM/cores (detected at boot)
        gpu: await gpuLiveStats(),       // live GPU util + VRAM (refreshed below)
        perf: null,                      // measured throughput (health timer, llama.cpp engine)
        // Boot outcome: llamacppChild exists iff the engine came up (fallback
        // cleared it). null = not the engine (Ollama mode / old farms).
        engineUp: config.llamacpp.enabled ? !!llamacppChild : null,
    };
    if (liveHealth.host) log.ok(`Hardware: ${log.paint.bold(liveHealth.host.gpu)} · ${liveHealth.host.vramGb}GB VRAM · ${liveHealth.host.ramGb}GB RAM · ${liveHealth.host.cpuCores} cores`);
    // The in-flight admin job rides the snapshot as `busy` so clients can explain a
    // bouncing proxy ("switching models…") instead of showing a raw error. jobBox is
    // indirection: the job system is defined further down, but the beacon can tick
    // before that code runs — a thunk that answers null until wired is TDZ-safe.
    const jobBox = { view: null };
    liveHealth.getJob = () => {
        const j = jobBox.view ? jobBox.view() : null;
        // Only the ACTIVE job is "busy" — a finished one lingers for the panel, but
        // clients must not keep saying "switching" after it is done.
        return j && !j.done ? { kind: j.kind, label: j.label, message: j.message, percent: j.percent } : null;
    };
    const getSnapshot = () => buildSnapshot(config, liveHealth);
    const snapshot = getSnapshot();

    let beacon = null;
    if (config.beacon.enabled) {
        beacon = new DiscoveryBeacon({
            group: config.beacon.group,
            port: config.beacon.port,
            intervalSec: config.beacon.intervalSec,
            getSnapshot,
        }).start();
        log.ok(`Discovery beacon → multicast ${config.beacon.group}:${config.beacon.port} + broadcast, every ${config.beacon.intervalSec}s (id ${snapshot.id.slice(0, 8)})`);
    } else {
        log.info('Discovery beacon disabled (config.beacon.enabled=false).');
    }
    // The admin control API is populated with the real functions below; selfServer only
    // calls control.* at REQUEST time (after startup completes — there is no `await`
    // between here and the Object.assign), so late assignment is safe. The stub methods
    // are belt-and-suspenders in case a future edit inserts an await into that span.
    const control = {
        getAdminState: async () => ({ error: 'starting' }),
        startModel: async () => ({ ok: false, error: 'farm still starting' }),
        stopModel: async () => ({ ok: false, error: 'farm still starting' }),
        setPlugin: async () => ({ ok: false, error: 'farm still starting' }),
        recommendClientPlugin: () => ({ ok: false, error: 'farm still starting' }),
        setBackend: async () => ({ ok: false, error: 'farm still starting' }),
        setLlamacppModel: async () => ({ ok: false, error: 'farm still starting' }),
        addLibraryModel: async () => ({ ok: false, error: 'farm still starting' }),
        removeLibraryModel: async () => ({ ok: false, error: 'farm still starting' }),
        setSlots: async () => ({ ok: false, error: 'farm still starting' }),
        setAdvertisedName: async () => ({ ok: false, error: 'farm still starting' }),
        setModelAlias: async () => ({ ok: false, error: 'farm still starting' }),
        setFarmPassword: async () => ({ ok: false, error: 'farm still starting' }),
        pullOllamaModel: async () => ({ ok: false, error: 'farm still starting' }),
        removeOllamaModel: async () => ({ ok: false, error: 'farm still starting' }),
        setContextLength: async () => ({ ok: false, error: 'farm still starting' }),
        setDefaultModel: async () => ({ ok: false, error: 'farm still starting' }),
    };

    // Connected desktop clients — each shell POSTs /lol/client-ping every ~10 s with
    // { id, name, platform, version, idleSec } (open route, trusted LAN — the farm's
    // Node process never sees chat traffic, LiteLLM does, so presence comes from the
    // clients). Entries are TTL-filtered at READ time (no sweeper): a closed client
    // vanishes from the panel within ~30 s. `idleSec` is the client's system-wide
    // input idle (Electron powerMonitor) — "is a human at that machine".
    const clients = new Map();
    const CLIENT_TTL_MS = 30000;
    const freshClients = () => {
        const now = Date.now();
        for (const [id, c] of clients) if (now - c.lastSeen > 10 * CLIENT_TTL_MS) clients.delete(id); // GC the long-gone
        return [...clients.entries()]
            .filter(([, c]) => now - c.lastSeen <= CLIENT_TTL_MS)
            .map(([id, c]) => ({ id, ...c, lastSeenSec: Math.round((now - c.lastSeen) / 1000) }))
            .sort((a, b) => (a.idleSec ?? Infinity) - (b.idleSec ?? Infinity));
    };
    const strCap = (v, max) => String(v == null ? '' : v).slice(0, max).trim();
    function onClientPing(body, ip) {
        if (!body || typeof body !== 'object') return { ok: false };
        const id = strCap(body.id, 64);
        if (!id) return { ok: false };
        if (!clients.has(id) && clients.size >= 200) {
            // Map full (garbage-flood cap). Don't just reject the newcomer — that would
            // let 200 junk ids lock every NEW real client out of presence. Free the
            // non-fresh slots first (they're already invisible in the UI), and if a
            // flood of still-live ids fills it anyway, evict the oldest: an actively-
            // heartbeating real client always wins a slot.
            const now = Date.now();
            for (const [cid, c] of clients) if (now - c.lastSeen > CLIENT_TTL_MS) clients.delete(cid);
            if (clients.size >= 200) {
                let oldest = null;
                for (const [cid, c] of clients) if (!oldest || c.lastSeen < oldest[1]) oldest = [cid, c.lastSeen];
                if (oldest) clients.delete(oldest[0]);
            }
        }
        clients.set(id, {
            name: strCap(body.name, 64) || null,
            platform: strCap(body.platform, 16) || null,
            version: strCap(body.version, 32) || null,
            idleSec: Number.isFinite(body.idleSec) ? Math.max(0, Math.round(body.idleSec)) : null,
            ip: strCap(ip, 64).replace(/^::ffff:/, '') || null,
            lastSeen: Date.now(),
        });
        liveHealth.clientsConnected = freshClients().length;
        return { ok: true };
    }
    const selfServer = startSelfServer({ httpPort: config.beacon.httpPort, getSnapshot, host: config.proxy.host, control, adminToken, onClientPing });
    log.ok(`Unicast discovery → ${log.paint.grey(`http://<ip>:${config.beacon.httpPort}/lol/self`)}`);
    log.ok(`Admin panel → ${log.paint.grey(`http://<ip>:${config.beacon.httpPort}/lol/admin`)} ${log.paint.grey('(token in the startup banner)')}`);

    // If SearXNG dies after boot, stop advertising it immediately (auxiliary — the
    // farm stays up; clients then cleanly disable web search). The health timer
    // below also re-probes it, catching a hung-but-not-exited instance.
    // Advertise-off: if a running plugin's child later exits, stop advertising it + kick.
    // bringUp/bringDown reuse the same liveHealth wiring so live toggles (control.setPlugin)
    // and boot behave identically.
    const refreshPluginHealth = () => { liveHealth.plugins = pluginsSummary(services, config); };
    const applyPluginHealth = (svc) => {
        liveHealth[svc.healthKey] = svc.up;
        if (svc.id === 'ocr') liveHealth.extractKey = svc.up ? svc.ctx.key : null;
        refreshPluginHealth();
    };
    for (const svc of services) {
        svc.onDown = (s) => {
            log.warn(`${s.label} exited — no longer available to clients.`);
            applyPluginHealth(s);
            if (beacon) beacon.kick();
        };
    }
    async function bringUp(svc) {
        const res = await svc.start(config, pluginRuntime);
        if (res && res.level && res.message) log[res.level](res.message);
        applyPluginHealth(svc);
        return svc.up;
    }
    async function bringDown(svc) {
        await svc.stop();
        applyPluginHealth(svc);
    }

    // Keep the advertised health honest: re-probe proxy + hosts periodically and
    // push a fresh beacon. Cheap (a few HTTP HEADs) and unref'd.
    const hosts = config.ollama.hosts.map(ollama.normalizeHost);

    // --- measured performance (llama.cpp engine) --------------------------------
    // Scrape llama-server's /metrics each tick and derive TRUE tok/s while
    // generating (delta tokens / delta of the engine's own generating-seconds
    // counter — wall-clock would average in idle time and read misleadingly low).
    // `last` keeps the most recent ACTIVE rate sticky, so the panel can answer
    // "how fast was it just now" even between requests. History feeds a sparkline.
    let perfPrev = null;
    const perfHistory = [];
    let perfLast = { genTokSec: null, promptTokSec: null, ts: null };
    async function samplePerf() {
        if (!config.llamacpp.enabled || !llamacppChild) { perfPrev = null; return null; }
        const m = await llamacpp.fetchMetrics(config.llamacpp.port);
        if (!m) return liveHealth.perf; // one failed scrape must not blank the panel
        const cur = perfMod.metricsSample(m, Date.now());
        const rates = perfMod.sampleRates(perfPrev, cur);
        perfPrev = cur;
        if (rates && !rates.reset && rates.genTokSec != null) {
            perfLast = { genTokSec: rates.genTokSec, promptTokSec: rates.promptTokSec, ts: cur.ts };
        }
        perfHistory.push({ t: cur.ts, gen: (rates && !rates.reset && rates.genTokSec) || 0 });
        if (perfHistory.length > 40) perfHistory.shift();
        return {
            engine: 'llama.cpp',
            genTokSec: (rates && !rates.reset) ? rates.genTokSec : null,   // this window
            lastGenTokSec: perfLast.genTokSec,                             // sticky
            lastPromptTokSec: perfLast.promptTokSec,
            lastActiveTs: perfLast.ts,
            busySlots: cur.busy,
            totalSlots: Math.max(1, config.llamacpp.parallel || 1),
            queued: cur.queued,
            kvUsed: cur.kvUsed,
        };
    }

    let healthInFlight = false; // skip a tick if the previous probe round is still running
    const healthTimer = setInterval(async () => {
        if (healthInFlight) return;
        healthInFlight = true;
        try {
            liveHealth.proxyUp = await proxyApi.proxyLive(baseUrl);
            const ups = await Promise.all(hosts.map((h) => ollama.version(h)));
            liveHealth.hostsUp = ups.filter(Boolean).length;
            const loadedLists = await Promise.all(hosts.map((h) => ollama.loadedModels(h)));
            liveHealth.loaded = [...new Set(loadedLists.flat())];
            liveHealth.gpu = await gpuLiveStats();
            // Only advertise a plugin while it's actually answering (and it came up) — so a
            // crashed/hung instance stops being advertised to clients. Guard on `wasUp`, NOT
            // `pid`: a child that died between boot and now has a null pid but must still be
            // re-probed to flip its stale advertisement off (probe() handles the null child).
            for (const svc of services) { if (svc.wasUp) liveHealth[svc.healthKey] = await svc.probe(config); }
            liveHealth.plugins = pluginsSummary(services, config);
            liveHealth.clientsConnected = freshClients().length; // decay the count when pings stop
            liveHealth.perf = await samplePerf();
            // While llama.cpp is the engine, an Ollama model left in VRAM (OCR with
            // keep-alive) starves it — the live incident was a 12 GB card paging with
            // both resident. Evict only when the GPU is idle and nearly full, so a
            // running extraction or generation is never yanked mid-flight.
            if (perfMod.shouldEvictOllama({
                llamacppOn: !!(config.llamacpp.enabled && llamacppChild),
                vramUsedGb: liveHealth.gpu && liveHealth.gpu.vramUsedGb,
                vramTotalGb: liveHealth.gpu && liveHealth.gpu.vramTotalGb,
                gpuUtil: liveHealth.gpu && liveHealth.gpu.gpuUtil,
                loadedCount: liveHealth.loaded.length,
            })) {
                log.warn(`GPU nearly full — freeing ${liveHealth.loaded.join(', ')} from VRAM (document reading reloads it on demand).`);
                for (const h of hosts.filter(isLocalHost)) {
                    for (const m of liveHealth.loaded) ollama.evictModel(h, m).catch(() => {});
                }
            }
            if (beacon) beacon.kick();
        } catch { /* probes are already failure-tolerant; never throw from the timer */ }
        finally { healthInFlight = false; }
    }, Math.max(10, config.beacon.intervalSec * 2) * 1000);
    if (healthTimer.unref) healthTimer.unref();

    // 6. Record runtime so status/down work from another shell. Wrapped so a live
    //    proxy restart (control.restartProxy) can refresh the recorded litellmPid —
    //    otherwise `lol down` from another shell would kill the stale (old) pid and
    //    leave the bounced LiteLLM running.
    const startedAt = Date.now();
    const writeRuntimeState = () => writeRuntime({
        litellmPid: child.pid,
        searxngPid: svcById.websearch.pid,
        kokoroPid: svcById.tts.pid,
        extractPid: svcById.ocr.pid,
        ollamaPids: oll.spawnedPids,
        llamacppPid: llamacppChild ? llamacppChild.pid : null,
        proxyPort: config.proxy.port,
        endpoint: snapshot.endpoint,
        openaiBaseUrl: snapshot.openaiBaseUrl,
        configPath,
        farmId: snapshot.id,
        startedAt,
        host: os.hostname(),
    });
    writeRuntimeState();

    log.plain('');
    log.ok(`${log.paint.bold(config.name)} is up${coordinator ? ' (coordinator)' : ''}.`);
    log.plain(`     OpenAI endpoint : ${log.paint.cyan(snapshot.openaiBaseUrl)}`);
    if (coordinator) log.plain(`     Coordinator     : balancing ${log.paint.bold(String(backends))} backend(s) — ${config.ollama.hosts.length} local host + ${peers.length} peer farm(s)`);
    log.plain(`     Reachable at    : ${snapshot.ips.map((ip) => `http://${ip}:${config.proxy.port}/v1`).join('  ')}`);
    log.plain(`     Admin panel     : ${log.paint.cyan(`http://${snapshot.ips[0] || '127.0.0.1'}:${config.beacon.httpPort}/lol/admin`)}   token ${log.paint.bold(adminToken)}`);
    log.plain(`     Stop with       : Ctrl-C   (or \`lol down\` from another shell)`);
    log.plain('');

    // 7. Supervise in the foreground.
    let stopping = false;
    const shutdown = async (sig) => {
        if (stopping) return;
        stopping = true;
        log.plain('');
        log.step(`Stopping (${sig}) …`);
        clearInterval(healthTimer);
        if (beacon) beacon.stop();
        try { selfServer.close(); } catch { /* already closed */ }
        await killTree(child.pid);
        for (const svc of services) { if (svc.pid) await killTree(svc.pid); }
        if (llamacppChild && llamacppChild.pid) await killTree(llamacppChild.pid);
        for (const pid of oll.spawnedPids) await killTree(pid);
        clearRuntime();
        log.ok('Farm stopped.');
        process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // The proxy-exit handler is NAMED so a deliberate restart (restartProxy, below)
    // can bounce LiteLLM without this treating it as a crash and tearing the farm down.
    // Guards: `restartingProxy` (we're deliberately bouncing) and identity (`c !== child`,
    // a superseded old child) both suppress the teardown.
    const onProxyExit = async (c, code) => {
        if (restartingProxy || c !== child || stopping) return;
        stopping = true;
        // Tear down everything we own BEFORE exiting (and AWAIT the Ollama kills so
        // process.exit doesn't orphan a local Ollama this CLI started).
        clearInterval(healthTimer);
        if (beacon) beacon.stop();
        try { selfServer.close(); } catch { /* already closed */ }
        // If the runtime file is already gone, `lol down` (another shell) cleared
        // it before killing us — an intentional stop, so exit quietly.
        const intentional = !readRuntime();
        if (intentional) { log.plain(''); log.ok('Farm stopped (via `lol down`).'); }
        else { log.err(`LiteLLM exited unexpectedly (code ${code}). Shutting down the farm.`); clearRuntime(); }
        for (const svc of services) { if (svc.pid) await killTree(svc.pid); }
        for (const pid of oll.spawnedPids) await killTree(pid);
        process.exit(intentional ? 0 : (code || 1));
    };
    // Bind the exit handler capturing the SPECIFIC child instance (`c`), so onProxyExit's
    // identity guard (`c !== child`) can actually tell a superseded old child from the
    // current one — a bare `onProxyExit(child, …)` would read the `let` at call time and
    // always see the current child, defeating the guard.
    const bindProxyExit = (c) => c.on('exit', (code) => onProxyExit(c, code));
    bindProxyExit(child);

    // --- live admin control (start/stop models) ---------------------------------
    // Regenerate the LiteLLM routing for the current in-memory config.models and bounce
    // the proxy child in place. LiteLLM here is config-only (no DB), so its /model/new
    // admin route is unavailable — a restart is the reliable way to change the served
    // set. Brief blip: in-flight requests drop during the few seconds it takes to come
    // back. Guarded by restartingProxy so onProxyExit doesn't tear the farm down.
    // Returns true ONLY when the new proxy actually became healthy.
    async function restartProxy() {
        if (stopping) return false;
        restartingProxy = true;
        try {
            writeLitellmConfig(config, yamlPath, peers);
            await killTree(child.pid);
            if (stopping) return false;                    // a signal landed during the kill → don't spawn an orphan
            const nc = spawnLitellm(config, yamlPath);
            let ncExited = false;
            nc.on('error', () => { /* a failed spawn surfaces via waitForProxy below */ });
            // Records a startup death AND (once healthy + current) supervises like the
            // initial child. Suppressed while restartingProxy / superseded (identity).
            nc.on('exit', (code) => { ncExited = true; onProxyExit(nc, code); });
            wireProxyIo(nc);
            child = nc;
            writeRuntimeState();                           // record the new pid immediately so `lol down` targets it
            const ok = await proxyApi.waitForProxy(baseUrl, { timeoutMs: 90000 });
            if (stopping) return false;
            if (!ok || ncExited) {                         // the new proxy never came up — don't leave a zombie
                log.err('Proxy restart failed — the new LiteLLM did not become healthy.');
                await killTree(nc.pid);
                return false;
            }
            return true;
        } finally {
            restartingProxy = false;
        }
    }

    // Apply an in-memory config.models change + bounce the proxy; on failure ROLL BACK to
    // the previous set and restore the last-known-good proxy (a failed model change must
    // never leave the farm without a working proxy).
    //
    // Callers persist the result (persistModels) once it sticks. This used to be
    // deliberately ephemeral, matching the boot picker — right while the panel was a
    // live-tweak console, wrong now that it is where an operator MANAGES the farm: a
    // model you added should still be there after a reboot.
    async function applyModels(next) {
        const before = config.models;
        config.models = next;
        if (await restartProxy()) return true;
        config.models = before;                            // revert
        await restartProxy();                              // it was healthy before → restore it
        return false;
    }
    const norm = (s) => String(s || '').replace(/:latest$/, '');   // gemma4 ≡ gemma4:latest
    const servedIdList = () => config.models.map((m) => m.id);

    async function startModel(id) {
        id = String(id || '').trim();
        if (!id) return { ok: false, error: 'No model id.' };
        if (config.models.some((m) => norm(m.id) === norm(id))) return { ok: true, already: true, servedModels: servedIdList() };
        const present = (await Promise.all(oll.reachable.map((h) => ollama.listModels(h)))).flat();
        if (!ollama.hasModel(present, id)) return { ok: false, error: `"${id}" isn't installed on any reachable host — pull it first.` };
        // Prefer the full definition from `preinstall` over a bare { id }: it carries
        // the stable alias (so chats bind to "reasoning", not the quant-specific id),
        // the explicit vision flag, and the params. Starting a preinstalled model from
        // the panel should serve it exactly as configured, not a degraded version.
        const known = (config.preinstall || []).find((m) => norm(m.id) === norm(id));
        const entry = known ? { ...known } : { id };
        if (!(await applyModels(config.models.concat([entry])))) {
            return { ok: false, error: 'The proxy did not come back — reverted to the previous model set.', servedModels: servedIdList() };
        }
        for (const h of oll.reachable.filter(isLocalHost)) ollama.warmModel(h, id, config.ollama.keepAlive, ollamaCtxNum()).catch(() => {});
        const warn = persistModels();
        if (beacon) beacon.kick();
        return { ok: true, servedModels: servedIdList(), warning: warn || null };
    }
    async function stopModel(id) {
        id = String(id || '').trim();
        const idx = config.models.findIndex((m) => norm(m.id) === norm(id));
        if (idx < 0) return { ok: true, already: true, servedModels: servedIdList() };
        if (config.models.length <= 1) return { ok: false, error: 'Cannot stop the last served model.' };
        const removed = config.models[idx];
        const next = config.models.slice();
        next.splice(idx, 1);
        // Promote a new default without mutating the shared entry object (rollback safety).
        if (removed.default && !next.some((m) => m.default)) next[0] = { ...next[0], default: true };
        if (!(await applyModels(next))) {
            return { ok: false, error: 'The proxy did not come back — reverted to the previous model set.', servedModels: servedIdList() };
        }
        for (const h of oll.reachable.filter(isLocalHost)) ollama.evictModel(h, removed.id).catch(() => {});
        const warn = persistModels();
        if (beacon) beacon.kick();
        return { ok: true, servedModels: servedIdList(), warning: warn || null };
    }

    // A richer view than the discovery snapshot: installed models per host (with sizes),
    // which are served, which are loaded in VRAM, + host/plugin health. Drives the page.
    async function getAdminState() {
        const perHost = await Promise.all(hosts.map(async (h) => ({
            installed: await ollama.listModelsDetailed(h),
            loaded: await ollama.loadedModels(h),
        })));
        const installed = new Map();
        for (const ph of perHost) for (const m of ph.installed) if (!installed.has(m.name)) installed.set(m.name, m);
        const loaded = [...new Set(perHost.flatMap((ph) => ph.loaded))];
        // Match on the normalized id (gemma4 ≡ gemma4:latest) so an untagged config
        // entry still flags the fully-tagged Ollama name as served/default — same
        // tolerance startModel/stopModel use, so the page shows the right Start/Stop.
        const servedIds = new Set(config.models.map((m) => norm(m.id)));
        const defaultId = norm((config.models.find((m) => m.default) || config.models[0] || {}).id || null);
        // What each served model is ADVERTISED as (per-model alias > global alias
        // for the default > the checkpoint id) — the panel shows it and offers a
        // per-model Rename (setModelAlias).
        const servedAsBy = new Map(servedEntries(config).map((e) => [norm(e.underlying), e.servedName]));
        return {
            name: config.name,
            models: [...installed.values()].map((m) => ({
                id: m.name, size: m.size, family: m.family, paramSize: m.paramSize,
                served: servedIds.has(norm(m.name)), loaded: loaded.includes(m.name), isDefault: norm(m.name) === defaultId,
                servedAs: servedAsBy.get(norm(m.name)) || null,
            })),
            servedNames: servedEntries(config).map((e) => e.servedName),
            modelAlias: (config.modelAlias || '').trim() || null,
            contextLength: config.ollama.contextLength,
            // WHICH ENGINE IS LIVE, and everything the panel needs to change it. The
            // panel used to show an Ollama-only view — installed tags, served flags,
            // a context selector — on a farm whose default model is served by
            // llama.cpp and appears in none of those lists.
            backend: backendInfo(config, liveHealth),
            llamacpp: {
                enabled: !!config.llamacpp.enabled,
                running: !!llamacppChild,
                alias: config.llamacpp.alias,
                model: config.llamacpp.model,
                mmproj: config.llamacpp.mmproj,
                library: config.llamacpp.library || [],
                contextLength: config.llamacpp.contextLength,        // number, or 'auto'
                contextResolved: config.llamacpp.contextResolved ?? null, // what actually serves
                parallel: config.llamacpp.parallel,
                kvCacheType: config.llamacpp.kvCacheType,
                mtp: !!config.llamacpp.mtp,
                port: config.llamacpp.port,
            },
            ollama: {
                hosts: config.ollama.hosts,
                numParallel: config.ollama.numParallel,
                contextLength: config.ollama.contextLength,        // number, or 'auto'
                contextResolved: config.ollama.contextResolved ?? null, // what actually serves
            },
            // Advisory capacity — see the snapshot. Nothing is refused past `slots`.
            capacity: { slots: backendInfo(config, liveHealth).slots, clients: freshClients().length },
            // The VRAM budget for the current shape — the panel flags context
            // options that cannot fit instead of offering 256k on a 12 GB card.
            fit: config.llamacpp.enabled ? computeFit() : null,
            // Measured throughput + a short history for the panel's sparkline.
            perf: liveHealth.perf,
            perfHistory,
            // Which Ollama model document reading drives (shown as a badge, and why
            // Delete refuses it) — null when OCR is off.
            ocrModel: config.ocr.enabled ? resolveOcrModel(config) : null,
            // Whether the llama.cpp engine is even possible here, and why it fell
            // back at boot if it did. The panel disables the engine button on these.
            llamacppAvailable: llamacpp.installed(config.llamacpp.binDir) || llamacpp.supported(),
            llamacppBootError,
            // Whether a shared password gates the proxy (the panel shows set/clear).
            requiresKey: !!config.proxy.masterKey,
            // The one long operation that can be in flight (model download, backend
            // switch, reload). The panel polls this endpoint anyway, so progress
            // rides along rather than needing a socket.
            job: jobView(),
            plugins: pluginsSummary(services, config),
            recommendedClientPlugins: config.recommendedClientPlugins || [],
            clients: freshClients(),   // desktop clients heartbeating us (most-active first)
            health: {
                hostsUp: liveHealth.hostsUp, hostsTotal: config.ollama.hosts.length,
                gpu: liveHealth.gpu || null, host: liveHealth.host || null, proxyUp: liveHealth.proxyUp !== false,
            },
        };
    }

    // Make a served model the DEFAULT: drives the snapshot's models[].default, which
    // every client feeds to OWUI as DEFAULT_MODELS (auto-selected model) — so this is
    // "pick what the fleet chats with by default". The proxy only needs a bounce in
    // global-alias mode (the alias binds to the default's underlying model); otherwise
    // the generated routing is unchanged and only the beacon needs a kick.
    async function setDefaultModel(id) {
        id = String(id || '').trim();
        const target = config.models.find((m) => norm(m.id) === norm(id));
        if (!target) return { ok: false, error: `"${id}" isn't a served model — start it first.`, servedModels: servedIdList() };
        if (target.default) return { ok: true, already: true, defaultModel: target.id };
        const next = config.models.map((m) => ({ ...m, default: norm(m.id) === norm(id) }));
        if ((config.modelAlias || '').trim()) {
            // Alias mode: the alias re-binds to the new default → routing changes.
            if (!(await applyModels(next))) {
                return { ok: false, error: 'The proxy did not come back — kept the previous default.', servedModels: servedIdList() };
            }
        } else {
            config.models = next;
        }
        for (const h of oll.reachable.filter(isLocalHost)) ollama.warmModel(h, target.id, config.ollama.keepAlive, ollamaCtxNum()).catch(() => {});
        const warn = persistModels();
        if (beacon) beacon.kick();
        return { ok: true, defaultModel: target.id, servedModels: servedIdList(), warning: warn || null };
    }

    // Change the context window — how much of a conversation or document the model reads
    // at once. This USED to write only ollama.contextLength, which meant that on a farm
    // running the llama.cpp backend (the default) the control did nothing at all to the
    // model everyone was actually chatting with. It now applies to whichever engine is
    // serving, and persists.
    //
    // The two engines take it differently, and the difference is visible to users:
    //   • llama.cpp — --ctx-size is argv AND is split across `parallel` slots, so this
    //     reloads the model and each user gets contextLength / slots.
    //   • Ollama — num_ctx rides the generated routing, so a proxy bounce is enough and
    //     every request keeps the full window.
    function setContextLength(tokens) {
        // 'auto' = the largest context this box can hold for the current model,
        // recomputed at every model load — the right choice on every card at once,
        // and the default. A number pins it.
        if (tokens === 'auto') {
            if (busy()) return busyErr();
            if (config.llamacpp.enabled) {
                if (config.llamacpp.contextLength === 'auto') return { ok: true, already: true, contextLength: 'auto' };
                return runJob('context', 'Setting the context window to automatic', async (progress) => {
                    const warn = persistLlamacpp({ contextLength: 'auto' });
                    const r = await reloadLlamacpp(progress);
                    if (!r.ok) {
                        persistLlamacpp({ contextLength: config.llamacpp.contextResolved || 16384 });
                        await reloadLlamacpp(() => {});
                        return { ok: false, error: `${r.error} Kept the previous size.` };
                    }
                    return { ok: true, message: `Context is automatic — currently ${config.llamacpp.contextResolved} tokens on this GPU.${warn || ''}` };
                });
            }
            // Ollama engine: persist 'auto', drop the cached probe verdict so the
            // sizing is re-measured (the operator is asking for a fresh answer),
            // then bounce the proxy so num_ctx carries the resolved number.
            if (config.ollama.contextLength === 'auto') return { ok: true, already: true, contextLength: 'auto' };
            const beforeCl = config.ollama.contextLength;
            const beforeResolved = config.ollama.contextResolved ?? null;
            return runJob('context', 'Setting the context window to automatic', async (progress) => {
                config.ollama.contextLength = 'auto';
                config.ollama.contextResolved = null;
                const warn = persist('ollama', { contextLength: 'auto' });
                dropOllamaCtxCache();
                await resolveOllamaContext(progress);
                if (!(await restartProxy())) {
                    config.ollama.contextLength = beforeCl;
                    config.ollama.contextResolved = beforeResolved ?? (typeof beforeCl === 'number' ? beforeCl : null);
                    persist('ollama', { contextLength: beforeCl });
                    await restartProxy();
                    return { ok: false, error: 'The proxy did not come back — kept the previous context size.' };
                }
                if (beacon) beacon.kick();
                return { ok: true, message: `Context is automatic — currently ${config.ollama.contextResolved} tokens on this box.${warn || ''}` };
            });
        }
        const want = Math.round(Number(tokens));
        if (!Number.isFinite(want) || want < 2048 || want > 262144) {
            return { ok: false, error: 'Context must be between 2048 and 262144 tokens.', contextLength: config.ollama.contextLength };
        }
        if (busy()) return busyErr();

        if (config.llamacpp.enabled) {
            if (want === config.llamacpp.contextLength) return { ok: true, already: true, contextLength: want };
            // A size the GPU cannot hold is ADVISORY, not blocked (owner call
            // 2026-08-28): llama-server won't refuse it — Windows overcommits into
            // system RAM and the farm "works" at a few tok/s (the AN-VR-01
            // incident) — so the panel warns + confirms, and the applied result
            // says exactly what was traded. The admin's explicit choice is honored.
            const fitAt = computeFit(want);
            const overWarn = (fitAt && fitAt.fits === false && fitAt.maxContext != null)
                ? ` ⚠ ${want} tokens needs ~${fitAt.needGb} GB — this GPU has ${fitAt.vramGb} GB, so part of the model now lives in system RAM. Expect a few tokens/second${fitAt.maxContext >= 4096 ? `; ${fitAt.maxContext} is the largest that fits` : ''}.`
                : '';
            const before = config.llamacpp.contextLength;
            const perSlot = Math.floor(want / Math.max(1, config.llamacpp.parallel));
            return runJob('context', `Setting the context window to ${want} tokens`, async (progress) => {
                const warn = persistLlamacpp({ contextLength: want });
                // Keep a PINNED Ollama size in step so a later backend switch does
                // not silently drop back to the old window. An 'auto' Ollama stays
                // auto — the switch re-probes for its own engine, which beats
                // inheriting llama.cpp's number (different KV economics).
                const ollamaPinned = typeof config.ollama.contextLength === 'number';
                if (ollamaPinned) {
                    config.ollama.contextLength = want;
                    config.ollama.contextResolved = want;
                    persist('ollama', { contextLength: want });
                }
                const r = await reloadLlamacpp(progress);
                if (!r.ok) {
                    persistLlamacpp({ contextLength: before });
                    if (ollamaPinned) {
                        config.ollama.contextLength = before;
                        config.ollama.contextResolved = before;
                        persist('ollama', { contextLength: before });
                    }
                    await reloadLlamacpp(() => {});
                    return { ok: false, error: `${r.error} Kept ${before} tokens. A too-large window is the usual cause — it must fit in VRAM alongside the weights.` };
                }
                const each = config.llamacpp.parallel > 1 ? ` (${perSlot} per slot across ${config.llamacpp.parallel} slots)` : '';
                return { ok: true, message: `Context window is ${want} tokens${each}.${overWarn}${warn || ''}` };
            });
        }

        if (want === config.ollama.contextLength) return { ok: true, already: true, contextLength: want };
        const before = config.ollama.contextLength;
        const beforeResolved = config.ollama.contextResolved ?? null;
        config.ollama.contextLength = want;
        config.ollama.contextResolved = want;
        const warn = persist('ollama', { contextLength: want });
        return runJob('context', `Setting the context window to ${want} tokens`, async () => {
            if (!(await restartProxy())) {
                config.ollama.contextLength = before;          // revert
                config.ollama.contextResolved = beforeResolved ?? (typeof before === 'number' ? before : null);
                persist('ollama', { contextLength: before });
                await restartProxy();                          // it was healthy before → restore it
                return { ok: false, error: 'The proxy did not come back — kept the previous context size.' };
            }
            // Ollama reloads a model on the first request at a new num_ctx, so re-warm the
            // default at the new size to hide that latency from whoever asks next.
            const def = (config.models.find((m) => m.default) || config.models[0] || {}).id;
            if (def) for (const h of oll.reachable.filter(isLocalHost)) ollama.warmModel(h, def, config.ollama.keepAlive, want).catch(() => {});
            if (beacon) beacon.kick();
            return { ok: true, message: `Context window is ${want} tokens.${warn || ''}` };
        });
    }

    // Toggle a FARM plugin (web search / voice / OCR) live: spawn or kill its service child,
    // reflect into liveHealth, kick the beacon so clients pick up the change. Ephemeral (the
    // config.<plugin>.enabled flip isn't persisted — matches the model-change philosophy).
    async function setPlugin(id, on) {
        const svc = svcById[id];
        if (!svc) return { ok: false, error: `Unknown plugin "${id}".` };
        on = !!on;
        config[svc.configKey].enabled = on;
        if (on) {
            if (svc.pid) return { ok: true, already: true, enabled: true, healthy: svc.up };
            await bringUp(svc);
            if (!svc.up) {
                // Came up unhealthy (e.g. SearXNG's JSON API off / Kokoro synth failed) but the
                // child may still be ALIVE — tear it down so we don't leak an unmanaged process,
                // then roll back the intent.
                config[svc.configKey].enabled = false;
                await bringDown(svc);
                writeRuntimeState();
                return { ok: false, error: `${svc.label} did not come up — see the farm log.` };
            }
        } else {
            await bringDown(svc);
        }
        writeRuntimeState();       // service pids changed → keep `lol down` accurate
        if (beacon) beacon.kick();
        return { ok: true, enabled: on, healthy: svc.up };
    }
    // Recommend (or un-recommend) a CLIENT-side plugin (e.g. "blender") to the fleet — the
    // farm can't run it, only advertise the intent; clients auto-apply what they can.
    function recommendClientPlugin(id, on) {
        id = String(id || '').trim();
        if (!id) return { ok: false, error: 'No plugin id.' };
        const set = new Set(config.recommendedClientPlugins || []);
        if (on) set.add(id); else set.delete(id);
        config.recommendedClientPlugins = [...set];
        if (beacon) beacon.kick();
        return { ok: true, recommendedClientPlugins: config.recommendedClientPlugins };
    }

    // --- persistence -------------------------------------------------------------
    // The panel's model start/stop stayed EPHEMERAL for a reason: "serve this for the
    // next hour" should not rewrite the operator's file. But the settings below are the
    // opposite kind — which engine runs, which weights it loads, what users see it
    // called, how many people it serves — set once and expected to survive a reboot.
    // Those round-trip through lol.config.json, applied in memory FIRST so a read-only
    // config directory degrades to "works now, forgets later" instead of failing.
    function persist(section, patch) {
        const r = patchSection(configPath, section, patch);
        return r.ok ? null : ` (not saved to lol.config.json: ${r.error} — reverts on restart)`;
    }
    function persistLlamacpp(patch) {
        Object.assign(config.llamacpp, patch);
        return persist('llamacpp', patch);
    }
    // config.models is what `lol up`'s picker rewrites at boot, so persisting it makes
    // panel changes survive a restart the same way an edited file would.
    function persistModels() {
        const r = patchConfigFile(configPath, (raw) => { raw.models = config.models; return raw; });
        return r.ok ? null : ` (not saved to lol.config.json: ${r.error} — reverts on restart)`;
    }

    // --- long jobs ---------------------------------------------------------------
    // Fetching a model is minutes of work; an admin HTTP request is seconds. So every
    // route that downloads weights STARTS a job and returns at once, and the panel —
    // already polling /lol/admin/state every 5 s — renders the progress. Strictly one
    // at a time: each ends in a llama-server reload or a proxy bounce, and two of those
    // racing is exactly how you end up with a farm that has no backend.
    let job = null;
    const jobView = () => (job && {
        id: job.id, kind: job.kind, label: job.label, message: job.message,
        percent: job.percent, done: job.done, ok: job.ok, error: job.error,
        startedAt: job.startedAt, finishedAt: job.finishedAt || null,
    });
    jobBox.view = jobView;   // from here on, the snapshot can report `busy`
    const busy = () => !!(job && !job.done);
    const busyErr = () => ({ ok: false, error: `The farm is busy: ${job.label}. Wait for it to finish.`, job: jobView() });
    let jobSeq = 0;
    function runJob(kind, label, fn) {
        if (busy()) return busyErr();
        const j = {
            id: `${Date.now().toString(36)}-${++jobSeq}`, kind, label,
            message: 'starting …', percent: null, done: false, ok: null, error: null,
            startedAt: Date.now(), finishedAt: null,
        };
        job = j;
        // Tell the fleet NOW, not at the next 10 s health tick: clients switch to
        // "the server is switching models…" before the proxy bounce can surface as
        // a raw connection error in someone's chat.
        if (beacon) beacon.kick();
        log.step(`${label} …`);
        const progress = (message, percent) => {
            if (job !== j) return;                       // superseded — never write into a stale job
            j.message = String(message == null ? '' : message).slice(0, 200);
            j.percent = (typeof percent === 'number' && Number.isFinite(percent))
                ? Math.max(0, Math.min(100, Math.round(percent))) : null;
        };
        // The job body runs INSIDE the same serialize chain as the quick ops
        // (start/stop/plugin/default): two admin tabs used to be able to run
        // startModel's restartProxy concurrently with a backend switch's — the
        // interleaved kill/spawn could tear the whole farm down (the exact hazard
        // the serialize comment documents, which these routes then bypassed).
        Promise.resolve()
            .then(() => serialize(() => fn(progress)))
            .then((res) => {
                j.ok = !(res && res.ok === false);
                j.error = (res && res.error) || null;
                j.message = (res && res.message) || (j.ok ? 'Done.' : (j.error || 'Failed.'));
                if (j.ok) log.ok(`${label}: ${j.message}`); else log.err(`${label}: ${j.error || j.message}`);
            })
            .catch((e) => {
                j.ok = false;
                j.error = String((e && e.message) || e);
                j.message = 'Failed.';
                log.err(`${label}: ${j.error}`);
            })
            .finally(() => {
                j.done = true;
                j.finishedAt = Date.now();
                if (beacon) beacon.kick();
            });
        return { ok: true, started: true, job: jobView() };
    }

    // --- backend control ---------------------------------------------------------
    // Reload llama-server for whatever the in-memory config now says, then regenerate
    // the routing. Every llama.cpp setting is argv, so "changing a setting" IS a restart
    // of the process — there is no lighter path.
    async function reloadLlamacpp(progress) {
        progress('stopping the current model', null);
        await stopLlamacpp();
        const r = await startLlamacpp(progress);
        if (!r.ok) return { ok: false, error: r.message };
        progress('reloading routing', null);
        if (!(await restartProxy())) return { ok: false, error: 'The model loaded but the proxy did not come back.' };
        if (beacon) beacon.kick();
        return { ok: true };
    }

    // Switch which engine answers the model clients auto-select. llama.cpp = one model,
    // fastest, speculative decoding; Ollama = the catalog, many models, slower. This is
    // the control that used to be invisible: nothing in the panel said which of the two
    // was live, so a farm serving llama.cpp looked identical to one serving Ollama under
    // the same alias.
    function setBackend(engine) {
        const want = String(engine || '').toLowerCase();
        if (want !== 'llamacpp' && want !== 'ollama') return { ok: false, error: 'Backend must be "llamacpp" or "ollama".' };
        const on = want === 'llamacpp';
        if (!!config.llamacpp.enabled === on) return { ok: true, already: true, engine: want };
        if (busy()) return busyErr();
        return runJob('backend', on ? 'Switching to llama.cpp' : 'Switching to Ollama', async (progress) => {
            // carryNameAcross MOVES the advertised name between llamacpp.alias and
            // the global modelAlias (memory + disk). A failed switch must put BOTH
            // back — restoring only `enabled` used to leave modelAlias nulled on
            // disk, so the recovered Ollama routing served raw ids and every chat
            // bound to the alias broke, surviving reboots.
            const before = {
                lcAlias: config.llamacpp.alias,
                globalAlias: config.modelAlias || null,
            };
            const restoreNames = () => {
                config.llamacpp.alias = before.lcAlias;
                config.modelAlias = before.globalAlias;
                persistLlamacpp({ alias: before.lcAlias });
                patchConfigFile(configPath, (raw) => { raw.modelAlias = before.globalAlias; return raw; });
            };
            const warn = persistLlamacpp({ enabled: on });
            carryNameAcross(on);
            if (on) {
                const r = await startLlamacpp(progress);
                if (!r.ok) {
                    persistLlamacpp({ enabled: false });     // roll the intent back with the state
                    restoreNames();
                    await restartProxy();
                    return { ok: false, error: r.message };
                }
            } else {
                progress('stopping llama.cpp', null);
                await stopLlamacpp();
                // Size the Ollama engine's context before its routing is generated
                // ('auto' probes once and caches — instant on later switches).
                progress('sizing the context window', null);
                await resolveOllamaContext(progress);
            }
            progress('reloading routing', null);
            if (!(await restartProxy())) {
                // A farm with no proxy serves NOBODY — undo the whole switch and
                // bring the previous engine's routing back rather than returning
                // an error over a dead endpoint.
                progress('proxy failed — undoing the switch', null);
                persistLlamacpp({ enabled: !on });
                restoreNames();
                if (!on) { await startLlamacpp(() => {}).catch(() => null); }
                else { await stopLlamacpp(); }
                await restartProxy();
                if (beacon) beacon.kick();
                return { ok: false, error: 'The proxy did not come back — the switch was undone.' };
            }
            if (beacon) beacon.kick();
            return { ok: true, message: `${on ? 'llama.cpp' : 'Ollama'} is now serving.${warn || ''}` };
        });
    }

    // Carry the advertised name across a backend switch. The two engines keep it on
    // different keys — llama.cpp on `llamacpp.alias`, Ollama on the global `modelAlias` —
    // and that name IS the model id clients bind to, so without this a switch silently
    // renames the model and every open chat asks its user to re-pick.
    //
    // Going TO llama.cpp we also clear `modelAlias`: it would then collide with
    // `llamacpp.alias`, and a colliding Ollama deployment is skipped in the generated
    // routing — the operator would lose that model from the picker without being told.
    function carryNameAcross(toLlamacpp) {
        const global = (config.modelAlias || '').trim();
        if (toLlamacpp) {
            if (global && global !== config.llamacpp.alias) persistLlamacpp({ alias: global });
            if (global) {
                config.modelAlias = null;
                patchConfigFile(configPath, (raw) => { raw.modelAlias = null; return raw; });
            }
        } else if (config.llamacpp.alias && config.llamacpp.alias !== global) {
            config.modelAlias = config.llamacpp.alias;
            patchConfigFile(configPath, (raw) => { raw.modelAlias = config.llamacpp.alias; return raw; });
        }
    }

    // Swap the .gguf llama-server loads: either a library entry (`id`) or any .gguf URL
    // (`url`), which is what makes "add a model" a real operation and not a config edit.
    // Rolls the config back and reloads the previous weights if the new ones don't come
    // up — a mistyped URL must not leave the farm with no backend.
    function setLlamacppModel(sel) {
        if (!config.llamacpp.enabled) return { ok: false, error: 'The llama.cpp backend is off — switch to it first.' };
        if (busy()) return busyErr();
        const lib = config.llamacpp.library || [];
        let url = null; let mmproj = null; let mtpOk = null; let label = null;
        if (sel && sel.id) {
            const e = lib.find((x) => x.id === sel.id);
            if (!e) return { ok: false, error: `Unknown model "${sel.id}".` };
            url = e.url; mmproj = e.mmproj || null; mtpOk = e.mtp; label = e.label;
        } else if (sel && sel.url) {
            url = String(sel.url).trim();
            if (!URL_RX.test(url)) return { ok: false, error: 'That does not look like a URL.' };
            mmproj = sel.mmproj ? String(sel.mmproj).trim() : null;
            label = url.split('/').pop();
        } else {
            return { ok: false, error: 'Choose a model, or give a .gguf URL.' };
        }
        if (url === config.llamacpp.model) return { ok: true, already: true, model: url };

        const before = { model: config.llamacpp.model, mmproj: config.llamacpp.mmproj, mtp: config.llamacpp.mtp };
        // Guard the one failure this project keeps hitting: MTP on a quant whose head
        // Unsloth stripped makes llama-server refuse to boot. If the library says the new
        // weights have no MTP head, turn MTP off WITH the swap rather than letting the
        // farm fail to come back.
        const patch = { model: url, mmproj };
        let mtpNote = '';
        if (config.llamacpp.mtp && mtpOk === false) {
            patch.mtp = false;
            mtpNote = ' Speculative decoding (MTP) was turned off — this quant has no MTP head.';
        }
        return runJob('model', `Loading ${label}`, async (progress) => {
            const warn = persistLlamacpp(patch);
            let r;
            // Belt and braces on top of startLlamacpp's own guard: whatever goes wrong
            // between here and a healthy llama-server, the operator must end up back on
            // the weights that were working. A farm bricked by a typo is unrecoverable
            // from the panel — the panel is served BY the farm.
            try { r = await reloadLlamacpp(progress); }
            catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
            if (!r.ok) {
                progress('rolling back to the previous model', null);
                persistLlamacpp(before);
                try { await reloadLlamacpp(() => {}); }
                catch (e) { return { ok: false, error: `${r.error} Rolling back ALSO failed (${(e && e.message) || e}) — restart the farm.` }; }
                return { ok: false, error: `${r.error} Rolled back to the previous model.` };
            }
            // The swap succeeded — but "loaded" is not "fits": an oversized model
            // pages instead of failing. Say so while the operator is still looking.
            const f = computeFit();
            const tight = (f && f.fits === false)
                ? ` ⚠ This shape needs ~${f.needGb} GB of the GPU's ${f.vramGb} GB — expect it to run slowly.`
                : '';
            return { ok: true, message: `Now serving ${label}.${mtpNote}${tight}${warn || ''}` };
        });
    }

    // The model LIBRARY is just a list, so adding a model is adding an entry — any
    // HuggingFace .gguf resolve/ URL works. Kept separate from activating one so an
    // operator can stage several and switch between them without re-typing URLs.
    function addLibraryModel(entry) {
        const url = String((entry && entry.url) || '').trim();
        if (!URL_RX.test(url)) return { ok: false, error: 'Give the https URL of a .gguf file.' };
        if (!GGUF_URL_RX.test(url)) return { ok: false, error: 'That URL does not end in .gguf — llama.cpp cannot load it.' };
        const lib = (config.llamacpp.library || []).slice();
        if (lib.some((e) => e.url === url)) return { ok: false, error: 'That model is already in the library.' };
        const base = decodeURIComponent(url.split('/').pop().split('?')[0]).replace(GGUF_EXT_RX, '');
        const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
            || `model-${lib.length + 1}`;
        const item = {
            id: lib.some((e) => e.id === slug) ? `${slug}-${lib.length + 1}` : slug,
            label: String((entry && entry.label) || base).slice(0, 80),
            url,
            mmproj: (entry && entry.mmproj) ? String(entry.mmproj).trim() : null,
            sizeGb: Number.isFinite(entry && entry.sizeGb) ? entry.sizeGb : null,
            // Unknown quants are assumed MTP-less: assuming the safe value makes a later
            // "turn MTP on" a deliberate act rather than a farm that silently won't boot.
            mtp: !!(entry && entry.mtp),
            note: String((entry && entry.note) || '').slice(0, 200),
        };
        lib.push(item);
        config.llamacpp.library = lib;
        const warn = persist('llamacpp', { library: lib });
        return { ok: true, model: item, library: lib, warning: warn || null };
    }

    function removeLibraryModel(id) {
        const lib = (config.llamacpp.library || []).slice();
        const idx = lib.findIndex((e) => e.id === id);
        if (idx < 0) return { ok: true, already: true, library: lib };
        if (lib[idx].url === config.llamacpp.model) {
            return { ok: false, error: 'That model is the one being served — switch to another first.', library: lib };
        }
        lib.splice(idx, 1);
        config.llamacpp.library = lib;
        const warn = persist('llamacpp', { library: lib });
        return { ok: true, library: lib, warning: warn || null };
    }

    // How many people this box serves AT ONCE. On llama.cpp this is --parallel, and
    // --ctx-size is SPLIT across the slots (verified: 16384 / 2 -> n_ctx_slot 8192), so
    // the caller is told what each user's context becomes. On Ollama it is
    // OLLAMA_NUM_PARALLEL, which only applies to an Ollama this CLI starts — so there it
    // needs a farm restart, not a proxy bounce, and we say so instead of pretending.
    function setSlots(count) {
        const want = Math.round(Number(count));
        if (!Number.isFinite(want) || want < 1 || want > 16) return { ok: false, error: 'Slots must be between 1 and 16.' };
        if (busy()) return busyErr();
        if (!config.llamacpp.enabled) {
            config.ollama.numParallel = want;
            const warn = persist('ollama', { numParallel: want });
            if (beacon) beacon.kick();
            return {
                ok: true, slots: want, needsFarmRestart: true,
                message: `Ollama will serve ${want} at a time after the farm restarts.${warn || ''}`,
            };
        }
        if (want === config.llamacpp.parallel) return { ok: true, already: true, slots: want };
        const before = config.llamacpp.parallel;
        // contextLength may be 'auto' — the resolved number is what users get.
        const ctxNum = config.llamacpp.contextResolved
            ?? (typeof config.llamacpp.contextLength === 'number' ? config.llamacpp.contextLength : 16384);
        const perSlot = Math.floor(ctxNum / want);
        return runJob('slots', `Serving ${want} at a time`, async (progress) => {
            const warn = persistLlamacpp({ parallel: want });
            const r = await reloadLlamacpp(progress);
            if (!r.ok) {
                persistLlamacpp({ parallel: before });
                await reloadLlamacpp(() => {});
                return { ok: false, error: `${r.error} Kept ${before} slot(s).` };
            }
            return { ok: true, message: `${want} slot(s), ${perSlot} tokens of context each.${warn || ''}` };
        });
    }

    // The model NAME users read. Over an OpenAI connection the id from /v1/models IS what
    // a picker displays, so this is the served alias, not a cosmetic label — which is
    // also why renaming asks existing chats to re-select the model.
    function setAdvertisedName(name) {
        if (busy()) return busyErr();
        const clean = String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').trim().slice(0, 48);
        if (!clean) return { ok: false, error: 'Give the model a name.' };
        if (NAME_BAD_RX.test(clean)) return { ok: false, error: 'Use letters, numbers, spaces and . - + : only.' };
        if (!config.llamacpp.enabled) {
            // Ollama side: the global alias re-binds the routing; no model reload needed.
            if (clean === (config.modelAlias || '')) return { ok: true, already: true, name: clean };
            const before = config.modelAlias;
            // A per-model alias on the DEFAULT model outranks modelAlias in the
            // routing (servedEntries), so left in place it would silently swallow
            // this rename. The most recent action wins: clear it.
            const defEntry = config.models.find((m) => m.default) || config.models[0];
            const defAliasBefore = defEntry && (defEntry.alias || '').trim() || null;
            if (defEntry && defAliasBefore) delete defEntry.alias;
            config.modelAlias = clean;
            const saved = patchConfigFile(configPath, (raw) => { raw.modelAlias = clean; return raw; });
            if (defAliasBefore) persistModels();
            return runJob('name', `Renaming the model to "${clean}"`, async () => {
                if (!(await restartProxy())) {
                    config.modelAlias = before;
                    if (defEntry && defAliasBefore) { defEntry.alias = defAliasBefore; persistModels(); }
                    // Revert the FILE too — memory and disk disagreeing until the next
                    // reboot is how names silently change overnight.
                    patchConfigFile(configPath, (raw) => { raw.modelAlias = before; return raw; });
                    await restartProxy();
                    return { ok: false, error: 'The proxy did not come back — kept the previous name.' };
                }
                if (beacon) beacon.kick();
                return { ok: true, message: `Users now see "${clean}".${saved.ok ? '' : ' (not saved to lol.config.json)'}` };
            });
        }
        if (clean === config.llamacpp.alias) return { ok: true, already: true, name: clean };
        const before = config.llamacpp.alias;
        return runJob('name', `Renaming the model to "${clean}"`, async (progress) => {
            const warn = persistLlamacpp({ alias: clean });
            const r = await reloadLlamacpp(progress);
            if (!r.ok) {
                persistLlamacpp({ alias: before });
                await reloadLlamacpp(() => {});
                return { ok: false, error: `${r.error} Kept the previous name.` };
            }
            return { ok: true, message: `Users now see "${clean}". Existing chats will ask to re-select the model.${warn || ''}` };
        });
    }

    // Per-model advertised name (Ollama catalog). Every downloaded model defaults
    // to its checkpoint id; the admin can override each one (owner call 2026-08-28).
    // A per-model alias WINS over the global modelAlias in the routing
    // (servedEntries), so renaming the default model here also renames what
    // clients auto-select. Empty clears the override — back to the checkpoint name.
    function setModelAlias(id, alias) {
        if (busy()) return busyErr();
        const entry = config.models.find((m) => norm(m.id) === norm(id));
        if (!entry) return { ok: false, error: `"${id}" is not in the served catalog — Offer it first.` };
        const clean = String(alias == null ? '' : alias).replace(/[\r\n\t]/g, ' ').trim().slice(0, 48) || null;
        if (clean && NAME_BAD_RX.test(clean)) return { ok: false, error: 'Use letters, numbers, spaces and . - + : only.' };
        if (clean) {
            // The name IS the id clients request — a duplicate silently merges two
            // models into one route (the alias-hygiene rule, enforced here).
            const taken = config.models.some((m) => m !== entry && ((m.alias || '').trim() || m.id) === clean)
                || (config.llamacpp.enabled && clean === config.llamacpp.alias)
                || (!entry.default && clean === (config.modelAlias || '').trim());
            if (taken) return { ok: false, error: `"${clean}" is already another model's name.` };
        }
        if (((entry.alias || '').trim() || null) === clean) return { ok: true, already: true };
        const before = (entry.alias || '').trim() || null;
        const apply = (v) => { if (v) entry.alias = v; else delete entry.alias; };
        // Standby catalog (llama.cpp serving): nothing here is routed, so persist
        // without bouncing the proxy — the name applies on the next engine switch.
        if (config.llamacpp.enabled) {
            apply(clean);
            const warn = persistModels();
            if (beacon) beacon.kick();
            return { ok: true, message: `"${entry.id}" will be offered as "${clean || entry.id}" when Ollama serves.${warn || ''}` };
        }
        return runJob('name', clean ? `Renaming ${entry.id} to "${clean}"` : `Renaming ${entry.id} back to its checkpoint name`, async () => {
            apply(clean);
            const warn = persistModels();
            if (!(await restartProxy())) {
                apply(before);
                persistModels();
                await restartProxy();
                return { ok: false, error: 'The proxy did not come back — kept the previous name.' };
            }
            if (beacon) beacon.kick();
            return { ok: true, message: `Users now see "${clean || entry.id}".${entry.default ? ' Existing chats will ask to re-select the model.' : ''}${warn || ''}`, servedModels: servedIdList() };
        });
    }

    // Shared farm password (ComfyQ-style): one string everyone on the LAN types
    // once. It becomes LiteLLM's master_key, which gates every /v1 route — chat,
    // models, everything — while /health/liveliness stays open (the farm's own
    // health checks and discovery must keep working). Clients learn from the
    // beacon's requiresKey that a password is needed and prompt for it.
    // Empty/null clears it. Persisted; a proxy bounce applies it.
    function setFarmPassword(password) {
        if (busy()) return busyErr();
        const clean = String(password == null ? '' : password).trim().slice(0, 128) || null;
        if ((config.proxy.masterKey || null) === clean) return { ok: true, already: true, requiresKey: !!clean };
        const before = config.proxy.masterKey || null;
        return runJob('security', clean ? 'Setting the farm password' : 'Removing the farm password', async () => {
            config.proxy.masterKey = clean;
            const warn = persist('proxy', { masterKey: clean ?? undefined });
            if (!(await restartProxy())) {
                config.proxy.masterKey = before;
                persist('proxy', { masterKey: before ?? undefined });
                await restartProxy();
                return { ok: false, error: 'The proxy did not come back — kept the previous setting.' };
            }
            if (beacon) beacon.kick();
            return { ok: true, message: clean
                ? `Password set. Clients now ask for it before connecting.${warn || ''}`
                : `Password removed — the farm is open to the LAN again.${warn || ''}` };
        });
    }

    // --- Ollama catalog management -----------------------------------------------
    // Download a model onto every LOCAL host. Remote hosts are deliberately untouched:
    // this CLI does not own them, and quietly filling someone else's disk is worse than
    // making the operator run it there too.
    function pullOllamaModel(id) {
        const want = String(id || '').trim();
        if (!want) return { ok: false, error: 'Give a model id, e.g. gemma4:12b.' };
        if (busy()) return busyErr();
        const targets = oll.reachable.filter(isLocalHost);
        if (!targets.length) return { ok: false, error: 'No local Ollama host to pull onto.' };
        return runJob('pull', `Downloading ${want}`, async (progress) => {
            for (const h of targets) {
                let failed = null;
                await ollama.pullModel(h, want, (line) => {
                    if (!line || typeof line !== 'object') return;
                    if (line.error) failed = line.error;
                    const pct = (line.total > 0 && line.completed >= 0) ? (line.completed / line.total) * 100 : null;
                    progress(line.status || 'downloading', pct);
                }).catch((e) => { failed = String((e && e.message) || e); });
                if (failed) return { ok: false, error: `Could not pull "${want}": ${failed}` };
            }
            // Serve it too — an "add a model" that leaves the model invisible to clients
            // is not what anyone means by adding a model.
            if (!config.models.some((m) => norm(m.id) === norm(want))) {
                if (!(await applyModels(config.models.concat([{ id: want }])))) {
                    return { ok: false, error: `Downloaded ${want}, but the proxy did not come back — it is not being served.` };
                }
            }
            const warn = persistModels();
            for (const h of targets) ollama.warmModel(h, want, config.ollama.keepAlive, config.ollama.contextLength).catch(() => {});
            if (beacon) beacon.kick();
            return { ok: true, message: `${want} downloaded and served.${warn || ''}` };
        });
    }

    // Delete a model's weights from every local host, un-serving it first so no client is
    // routed at a model that is being removed underneath it.
    function removeOllamaModel(id) {
        const want = String(id || '').trim();
        if (!want) return { ok: false, error: 'No model id.' };
        if (busy()) return busyErr();
        const isServed = config.models.some((m) => norm(m.id) === norm(want));
        if (isServed && config.models.length <= 1) {
            return { ok: false, error: 'This is the only model in the catalog — add another before removing it.' };
        }
        if (config.ocr.enabled && norm(resolveOcrModel(config)) === norm(want)) {
            return { ok: false, error: 'Document reading (OCR) uses this model — turn OCR off first, or set ocr.model to another one.' };
        }
        const targets = oll.reachable.filter(isLocalHost);
        return runJob('remove', `Removing ${want}`, async (progress) => {
            if (isServed) {
                progress('un-serving', null);
                const r = await stopModel(want);
                if (!r.ok) return { ok: false, error: r.error };
            }
            progress('deleting the weights', null);
            const failures = [];
            for (const h of targets) {
                const r = await ollama.deleteModel(h, want);
                if (!r.ok) failures.push(`${h}: ${r.error}`);
            }
            const warn = persistModels();
            if (beacon) beacon.kick();
            if (failures.length) return { ok: false, error: `Un-served, but the files could not be deleted — ${failures.join('; ')}` };
            return { ok: true, message: `${want} removed.${warn || ''}` };
        });
    }

    // Serialize mutations: the admin page's client-side `busy` flag doesn't bind a second
    // browser tab, another device sharing the token, or a curl script, and two overlapping
    // restarts share `restartingProxy` — one's finally clears it while the other is still
    // mid-restart, which could unmask onProxyExit and tear the farm down. A single in-flight
    // chain makes start/stop/plugin-toggle atomic regardless of how many callers hit at once.
    let mutating = Promise.resolve();
    const serialize = (fn) => { const p = mutating.then(fn, fn); mutating = p.catch(() => {}); return p; };
    Object.assign(control, {
        getAdminState,                                     // read-only — no lock needed
        // Quick ops: refuse while a JOB runs (its model reload owns the farm),
        // then take the same serialize chain the job bodies run in. One lock,
        // one rule, no interleaved proxy restarts.
        startModel: (id) => busy() ? busyErr() : serialize(() => startModel(id)),
        stopModel: (id) => busy() ? busyErr() : serialize(() => stopModel(id)),
        setDefaultModel: (id) => busy() ? busyErr() : serialize(() => setDefaultModel(id)),
        setContextLength: (n) => setContextLength(n),   // guards busy() itself (auto + numeric paths)
        setPlugin: (id, on) => busy() ? busyErr() : serialize(() => setPlugin(id, on)),
        recommendClientPlugin,                             // trivial array mutation + kick
        // (engine supervision arms here — see engineDownBox)
        // Structural changes: these persist to lol.config.json and (except the two
        // library edits) run as a JOB, because they reload a model. They guard on
        // `busy` themselves, so they are registered unserialized — queueing a model
        // swap behind a download would hide it from the operator for minutes.
        setBackend,
        setLlamacppModel,
        addLibraryModel: (e) => busy() ? busyErr() : serialize(() => addLibraryModel(e)),
        removeLibraryModel: (id) => busy() ? busyErr() : serialize(() => removeLibraryModel(id)),
        setSlots,
        setAdvertisedName,
        setModelAlias,
        setFarmPassword,
        pullOllamaModel,
        removeOllamaModel,
    });
    engineDownBox.fn = onEngineDown;   // serialize + liveHealth exist now — arm supervision
    // If llama-server died DURING the boot window (between its health-OK and
    // this line — proxy/plugin startup can take a minute), the exit handler
    // found fn null and only cleared llamacppChild. Handle it now instead of
    // advertising unhealthy forever with no restart and no reason.
    if (config.llamacpp.enabled && !llamacppChild) onEngineDown(-1);
    engineDownBox.markUp = () => { liveHealth.engineUp = true; if (beacon) beacon.kick(); };

    // Keep the event loop alive.
    return new Promise(() => {});
}

module.exports = { run, resolveOcrModel };
