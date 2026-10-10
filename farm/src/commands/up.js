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
const vllmMod = require('../vllm');
const proxyApi = require('../proxy');
const { loadConfig, ConfigSchema, VLLM_LIBRARY } = require('../config');
const {
    writeLitellmConfig, buildLitellmConfig, servedEntries, ollamaServes, defaultModelEntry,
    carryNameAcross, applyNamePlan, engineFallback, engineOf,
} = require('../litellm');
const { buildSnapshot, backendInfo } = require('../snapshot');
const { patchSection, patchConfigFile, readRawConfig, takeOverFile, undoTakeOverFile } = require('../configFile');
const { detectHardware, gpuLiveStats, gpuFreeGb, untilSteady } = require('../systemInfo');
const perfMod = require('../perf');
const ggufMod = require('../gguf');
const fsMod = require('fs');
const pathMod = require('path');
const { DiscoveryBeacon } = require('../beacon');
const { PeerListener } = require('../peerListener');
const { selectModels } = require('../modelPicker');
const { makeServices, pluginsSummary } = require('../plugins/registry');
const embedMod = require('../embed');
const { sendKey: sendBusKey } = require('../bus');
const { farmId, pluginKey } = require('../identity');
const { startSelfServer } = require('../selfServer');
const { createSeats, createGateStats, startSeatGate } = require('../seats');
const {
    readRuntime, writeRuntime, clearRuntime, isAlive, killTree, spawnLitellm,
} = require('../proc');

const LOCAL_RX = /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i;
// Admin-input validation for the model-library routes.
const URL_RX = /^https?:\/\/\S+$/i;
const GGUF_URL_RX = /\.gguf(\?|$)/i;
const GGUF_EXT_RX = /\.gguf$/i;
const NAME_BAD_RX = /[^\w .\-+:]/;   // the advertised model name goes into a URL path and a picker

// A setting the farm could not write down: said in plain words (D10: no file or key name reaches the operator), with
// the reason in the farm's log. null when it was saved.
function notSaved(r) {
    if (!r || r.ok) return null;
    log.warn(`A setting could not be saved: ${r.error}`);
    return ' (not saved on this computer, so it goes back at the next farm restart)';
}

function isLocalHost(baseUrl) {
    try { return LOCAL_RX.test(new URL(baseUrl).hostname); } catch { return false; }
}
// The port of a server on this computer, or null for one elsewhere.
function loopbackPort(baseUrl) {
    if (!isLocalHost(baseUrl)) return null;
    const u = new URL(baseUrl);
    return Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
}

// The vision model the OCR service drives: an explicit config.ocr.model wins; else
// the served DEFAULT model if it's vision-capable; else any served vision model;
// else the default (so it at least runs — a text-only model just OCRs poorly). This
// is the real Ollama tag (`underlying`), since Ollama-OCR hits raw Ollama, not the
// alias-fronted proxy.
// While the farm's vLLM serves, Ollama only reads documents, beside it and in the memory
// kept for it (vllm.ocrReserveGib, 9 GB): gemma4:12b (vision, ~8 GB) when it is installed
// on a local host (`installed`, the local /api/tags names), rather than a standby default
// that may not fit (production's was qwen3.8, 17.7 GB on disk; docs/VLLM_MANAGED_PLAN.md
// §1.4). Only beside vLLM, where that reserve exists: a llama.cpp farm chose its standby
// default to fit beside llama-server, and an external server's farm keeps its own choice.
const OCR_BESIDE = 'gemma4:12b';
function resolveOcrModel(config, installed = []) {
    if (config.ocr.model) return config.ocr.model;
    if (engineOf(config) === 'vllm' && installed.some((n) => n === OCR_BESIDE)) return OCR_BESIDE;
    const entries = servedEntries(config);
    const pick = entries.find((e) => e.isDefault && e.vision)
        || entries.find((e) => e.vision)
        || entries.find((e) => e.isDefault)
        || entries[0];
    return pick ? pick.underlying : (config.models[0] && config.models[0].id);
}

// A fallback (engineFallback) may give the Ollama default the failed engine's name
// for this run, in memory only — say so, since the file will not show it.
function logFallbackNames(plan) {
    if (!plan) return;
    if (plan.llamacppAlias) log.info(`llama.cpp serves as "${plan.llamacppAlias}" for this run — the name chats are bound to (not saved).`);
    if (plan.modelAlias) log.info(`The Ollama default serves as "${plan.modelAlias}" for this run — the name chats are bound to (not saved).`);
}

// Spawn a local `ollama serve` with the configured concurrency env. Returns the
// child pid, or null if it couldn't be started. Only used when a LOCAL host is
// down — we never touch a remote box or an already-running local Ollama.
function spawnLocalOllama(config, baseUrl) {
    const env = {
        OLLAMA_NUM_PARALLEL: String(config.ollama.numParallel),
        OLLAMA_MAX_LOADED_MODELS: String(config.ollama.maxLoadedModels),
        OLLAMA_FLASH_ATTENTION: config.ollama.flashAttention ? '1' : '0',
        // Quantized KV (q8_0 default): every model holds ~twice the context in the
        // same VRAM, and the auto-context probe then MEASURES that bigger window.
        // Needs flash attention — never set it without.
        ...(config.ollama.flashAttention && config.ollama.kvCacheType && config.ollama.kvCacheType !== 'f16'
            ? { OLLAMA_KV_CACHE_TYPE: config.ollama.kvCacheType } : {}),
        // Keep-warm policy depends on WHICH engine serves. Ollama engine: the
        // configured keepAlive ('-1' = forever — right for a dedicated box). But when
        // llama.cpp or an external server is the engine, the only Ollama user is the
        // OCR plugin, and a vision model pinned forever ('-1') next to the engine that
        // serves chat is how a 12 GB card ends up paging every token. 5 minutes: hot
        // across a document batch, gone before it starves chat.
        OLLAMA_KEEP_ALIVE: ollamaServes(config) ? config.ollama.keepAlive : '5m',
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

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// The bearer an external server may want (most local servers are keyless).
const externalHeaders = (ex) => (ex.apiKey ? { authorization: `Bearer ${ex.apiKey}` } : {});

// Is the operator-run OpenAI-compatible backend answering? (vllm.answers: GET {baseUrl}/models,
// 401/403 count as there.) Short timeout: this runs on the health tick.
function externalAlive(ex, timeoutMs = 4000) {
    return vllmMod.answers(ex.baseUrl, timeoutMs, externalHeaders(ex));
}

// Measured performance: the engine's /metrics, scraped on each health tick, read
// as TRUE tok/s while generating (delta tokens / delta of the engine's own
// generating-seconds — wall clock would average in idle time and read misleadingly
// low). `last` keeps the most recent ACTIVE window sticky, so the panel can answer
// "how fast was it just now" even between requests; `history` feeds a sparkline.
// llama.cpp is read while its child runs. An external server is read while it
// answers, and only when its /metrics is a vLLM's — anything else keeps perf null
// as before (no card, capacity.busy/queued null). The vLLM the farm runs is read while it
// is ready (`vllmReady`). `health` is liveHealth.
function makePerfSampler(config, health, llamacppUp, vllmReady = () => false) {
    let prev = null;
    const history = [];
    let last = { genTokSec: null, promptTokSec: null, cacheHitRatio: null, throughputTokSec: null, draftAcceptRatio: null, ts: null };
    async function sample() {
        const ex = config.external;
        const engine = engineOf(config);
        let cur;
        if (engine === 'llamacpp' && llamacppUp()) {
            const m = await llamacpp.fetchMetrics(config.llamacpp.port);
            if (!m) return health.perf; // one failed scrape must not blank the panel
            cur = perfMod.metricsSample(m, Date.now());
        } else if ((engine === 'external' && health.engineUp) || (engine === 'vllm' && vllmReady())) {
            const m = engine === 'vllm'
                ? await llamacpp.fetchMetrics(perfMod.metricsUrlFor(vllmMod.baseUrl(config)), 3000)
                : await llamacpp.fetchMetrics(perfMod.metricsUrlFor(ex.baseUrl), 3000, externalHeaders(ex));
            if (!m) return health.perf;
            cur = perfMod.vllmSample(m, Date.now());
            if (!cur) { prev = null; return null; }   // it answers, but it is not a vLLM
        } else { prev = null; return null; }
        const rates = perfMod.sampleRates(prev, cur);
        prev = cur;
        if (rates && !rates.reset && rates.genTokSec != null) {
            last = {
                genTokSec: rates.genTokSec,
                promptTokSec: rates.promptTokSec,
                // Sticky like the speeds: the ratio of the LAST active window is
                // what answers "did that turn hit the cache" between requests.
                cacheHitRatio: rates.cacheHitRatio ?? last.cacheHitRatio,
                throughputTokSec: rates.throughputTokSec ?? null,
                draftAcceptRatio: rates.draftAcceptRatio ?? last.draftAcceptRatio,
                ts: cur.ts,
            };
        }
        history.push({ t: cur.ts, gen: (rates && !rates.reset && rates.genTokSec) || 0 });
        if (history.length > 40) history.shift();
        const out = {
            engine: cur.vllm ? 'vllm' : 'llama.cpp',
            genTokSec: (rates && !rates.reset) ? rates.genTokSec : null,   // this window
            lastGenTokSec: last.genTokSec,                                 // sticky
            lastPromptTokSec: last.promptTokSec,
            lastCacheHitRatio: last.cacheHitRatio,                         // 0..1, null = no data yet
            lastActiveTs: last.ts,
            busySlots: cur.busy,
            totalSlots: backendInfo(config, health).slots,
            queued: cur.queued,
            kvUsed: cur.kvUsed,   // null on llama.cpp b10670+ (upstream dropped the metric)
        };
        // vLLM's own numbers; llama.cpp's perf (and so its card) keeps exactly its old shape.
        if (cur.vllm) {
            Object.assign(out, {
                lastThroughputTokSec: last.throughputTokSec,   // everyone together
                lastDraftAcceptRatio: last.draftAcceptRatio,   // null without a drafter
                kvPoolTokens: cur.poolTokens,                  // null when vLLM does not say
            });
        }
        return out;
    }
    return { sample, history };
}

// Download-rate meter for long fetches. A percentage alone cannot answer the
// question an operator actually has after two minutes of staring at a bar —
// "is this moving, and how long more?" — so every byte-producing job feeds one
// of these and the panel renders speed + ETA from it.
// Smoothed over a short window (EWMA over ~5 s of samples) because raw
// instantaneous rates from a chunked HTTP stream swing wildly and a number that
// flickers between 3 and 400 MB/s reads as broken, not informative.
function makeRateMeter(smoothing = 0.25) {
    let lastAt = 0;
    let lastBytes = 0;
    let bps = null;
    return {
        sample(bytes) {
            const now = Date.now();
            if (!lastAt) { lastAt = now; lastBytes = bytes; return { bytesPerSec: null }; }
            const dt = (now - lastAt) / 1000;
            if (dt < 1) return { bytesPerSec: bps };   // sample at most once a second
            const db = bytes - lastBytes;
            lastAt = now; lastBytes = bytes;
            // A restart (new host, layer re-count) can make bytes go backwards;
            // don't emit a negative rate, just wait for the next sample.
            if (db < 0) return { bytesPerSec: bps };
            const inst = db / dt;
            bps = (bps == null) ? inst : (bps * (1 - smoothing) + inst * smoothing);
            return { bytesPerSec: bps };
        },
    };
}

// The farm's two slots for long work (docs/VLLM_MANAGED_PLAN.md §3.5).
// - The JOB slot: what changes what the farm serves (a switch, a restart, an Apply, an Ollama pull). Strictly
//   one at a time, and its body runs in `serialize`, the one chain every quick admin change takes too: two
//   proxy restarts interleaving tear the farm down. It rides the snapshot as `busy`, so clients say "switching…".
// - The DOWNLOAD slot: installing vLLM and downloading its models (minutes to most of an hour). One at a time
//   too, but OUTSIDE serialize and outside busy(): a crash of vLLM during a 23 GB download is handled at once,
//   and an engine switch is never refused because of one. Never in the snapshot's `busy`.
// Either can carry a `cancel` (the panel's Stop): the job is marked cancelled and the cancel runs in the
// background; the body reads ctl.cancelled() and returns.
function makeJobs({ kick = () => {}, logger = log } = {}) {
    let mutating = Promise.resolve();
    const serialize = (fn) => { const p = mutating.then(fn, fn); mutating = p.catch(() => {}); return p; };
    let job = null; let dl = null; let seq = 0;
    const view = (j) => j && {
        id: j.id, kind: j.kind, label: j.label, message: j.message,
        percent: j.percent, done: j.done, ok: j.ok, error: j.error,
        startedAt: j.startedAt, finishedAt: j.finishedAt || null,
        // Structured progress, so the panel renders numbers instead of parsing a
        // sentence: bytes done / total, live speed, seconds remaining. null on
        // jobs that move no bytes (a proxy bounce, an engine switch).
        bytes: j.bytes ?? null, total: j.total ?? null,
        bytesPerSec: j.bytesPerSec ?? null, etaSec: j.etaSec ?? null,
        cancellable: !!(j.cancel && !j.done && !j.cancelled), cancelled: !!j.cancelled,
        about: j.about || null,   // a download's library entry (the panel's row says downloading)
    };
    // A body that returned is not busy, even in the few microtasks before `done` is set: a restart queued from
    // inside serialize (onVllmDown) must not be refused by the job it follows.
    const busy = () => !!(job && !job.done && !job.settled);
    const busyErr = () => ({ ok: false, error: `The farm is busy: ${job.label}. Wait for it to finish.`, job: view(job) });
    function open(kind, label, cancel) {
        const j = {
            id: `${Date.now().toString(36)}-${++seq}`, kind, label,
            message: 'starting …', percent: null, done: false, ok: null, error: null,
            startedAt: Date.now(), finishedAt: null,
            bytes: null, total: null, bytesPerSec: null, etaSec: null, cancel, cancelled: false, settled: false,
        };
        // `detail` (optional) carries { bytes, total } for jobs that download.
        // Kept a separate argument so the dozens of existing progress('x', pct)
        // calls stay valid — a job that moves no bytes simply never passes it.
        // Speed and ETA are derived HERE, from one meter per job, so every
        // download path (Ollama pull, llama.cpp weights, shards, vLLM's models)
        // reports them identically and none of them has to know about rates.
        const meter = makeRateMeter();
        j.progress = (message, percent, detail = null) => {
            if (j.done) return;
            j.message = String(message == null ? '' : message).slice(0, 200);
            j.percent = (typeof percent === 'number' && Number.isFinite(percent))
                ? Math.max(0, Math.min(100, Math.round(percent))) : null;
            if (detail && detail.bytes != null) {
                j.bytes = detail.bytes;
                j.total = detail.total ?? null;
                const moreToCome = j.total == null || j.total > j.bytes;
                // Once the bytes are all in, a speed and a countdown are noise at
                // best and a lie at worst — the remaining phases (verifying,
                // saving, restarting the proxy) move no bytes, and a decaying
                // "15 MB/s · a few seconds left" made a finished download look
                // stuck. Keep the totals, drop the motion numbers.
                j.bytesPerSec = moreToCome ? meter.sample(detail.bytes).bytesPerSec : null;
                j.etaSec = (j.bytesPerSec && moreToCome)
                    ? Math.round((j.total - j.bytes) / j.bytesPerSec) : null;
            } else {
                // A phase that reports no bytes at all (a proxy bounce, a model
                // load): whatever rate we last measured belongs to the previous
                // phase, so stop showing it rather than let it go stale.
                j.bytesPerSec = null;
                j.etaSec = null;
            }
        };
        return j;
    }
    function settle(j, label, p) {
        return p.then((res) => {
            j.ok = !(res && res.ok === false);
            j.error = (res && res.error) || null;
            j.message = (res && res.message) || (j.ok ? 'Done.' : (j.error || 'Failed.'));
            if (j.ok) logger.ok(`${label}: ${j.message}`); else logger.err(`${label}: ${j.error || j.message}`);
        }).catch((e) => {
            j.ok = false;
            j.error = String((e && e.message) || e);
            j.message = 'Failed.';
            logger.err(`${label}: ${j.error}`);
        }).finally(() => {
            j.done = true;
            j.finishedAt = Date.now();
            kick();
        });
    }
    const ctl = (j) => ({ cancelled: () => j.cancelled, job: j });
    function runJob(kind, label, fn, { cancel = null } = {}) {
        if (busy()) return busyErr();
        const j = open(kind, label, cancel);
        job = j;
        // Tell the fleet NOW, not at the next 10 s health tick: clients switch to
        // "the server is switching models…" before the proxy bounce can surface as
        // a raw connection error in someone's chat.
        kick();
        logger.step(`${label} …`);
        // The job body runs INSIDE the same serialize chain as the quick ops
        // (start/stop/plugin/default): two admin tabs used to be able to run
        // startModel's restartProxy concurrently with a backend switch's — the
        // interleaved kill/spawn could tear the whole farm down.
        settle(j, label, Promise.resolve().then(() => serialize(async () => {
            try { return await fn(j.progress, ctl(j)); } finally { j.settled = true; }
        })));
        return { ok: true, started: true, job: view(j) };
    }
    // `onSettled` runs once the download is over (done): what records it (the runtime file) records its end too.
    function runDownload(kind, label, fn, { cancel = null, about = null, onSettled = null } = {}) {
        if (dl && !dl.done) return { ok: false, error: `A download is already running: ${dl.label}.`, download: view(dl) };
        const j = open(kind, label, cancel);
        j.about = about;
        dl = j;
        logger.step(`${label} …`);
        settle(j, label, Promise.resolve().then(() => fn(j.progress, ctl(j)))).then(() => onSettled && onSettled()).catch(() => {});
        return { ok: true, started: true, download: view(j) };
    }
    // The panel's Stop, for the job slot ('job') or the download slot ('download').
    function cancel(slot) {
        const j = slot === 'download' ? dl : job;
        if (!j || j.done) return { ok: false, error: 'Nothing is running there.' };
        if (!j.cancel) return { ok: false, error: `${j.label} cannot be stopped halfway.` };
        if (j.cancelled) return { ok: true, already: true };
        j.cancelled = true;
        j.message = 'stopping …';
        Promise.resolve().then(j.cancel).catch((e) => logger.warn(`Stopping ${j.label}: ${(e && e.message) || e}`));
        kick();
        return { ok: true };
    }
    return {
        serialize, runJob, runDownload, cancel, busy, busyErr,
        jobView: () => view(job), downloadView: () => view(dl),
        downloading: () => (dl && !dl.done ? dl : null),
    };
}

// Ollama /api/pull status -> something worth showing a person. Its raw statuses
// are 'pulling manifest', 'pulling <12-hex-digest>', 'verifying sha256 digest',
// 'writing manifest', 'success' — the digest one is both the most common and the
// least meaningful, so it never reaches the UI.
function pullPhase(status) {
    const s = String(status || '').toLowerCase();
    if (!s) return 'downloading';
    if (/^pulling manifest/.test(s)) return 'reading the model index';
    if (/^pulling/.test(s)) return 'downloading';
    if (/verifying/.test(s)) return 'checking the download is intact';
    if (/writing manifest/.test(s)) return 'saving';
    if (/^success/.test(s)) return 'finishing up';
    if (/using existing|already exists/.test(s)) return 'already on disk';
    return s.slice(0, 60);
}

// The workshop setting (owner 2026-10-04, multi-user plan 1.2): how long an idle seat
// stays held, proxy.seatIdleSec — short for a class, back to 15 min after. Seconds here
// and in the file; the panel speaks minutes. The gate reads it through a thunk
// (seats.js), so applying it restarts nothing. null = absent or unchanged,
// { error } = refused, else { sec, label, apply() → a not-saved warning or null }.
function seatIdleChange(config, configPath, value) {
    if (value == null) return null;
    const sec = Number(value);
    if (!Number.isInteger(sec) || sec < 60 || sec > 3600) return { error: 'An idle seat must free after 1 to 60 minutes (60–3600 s).' };
    if (sec === (config.proxy.seatIdleSec || 900)) return null;
    return {
        sec,
        label: `idle seats free after ${+(sec / 60).toFixed(1)} min`,
        apply() {
            config.proxy.seatIdleSec = sec;
            const r = patchSection(configPath, 'proxy', { seatIdleSec: sec });
            return notSaved(r);
        },
    };
}

// llama.cpp's 'auto' context: the largest that fits (computeFit's maxContext), never under 4096.
// maxContext 0 means not even 4096 fits the free VRAM, so the floor, not 16384; only no verdict
// at all (no model file, no VRAM reading) falls back to 16384.
function autoLlamacppContext(fit) {
    return Math.max(4096, fit && fit.maxContext != null ? fit.maxContext : 16384);
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
        // WARN, not info: until 2026-09-07 this was a note nobody acted on, while
        // the farm went on advertising the configured numbers as if they applied.
        // On the dev box that meant "2 slots, q8_0 KV" advertised against a daemon
        // running n_slots=1 and f16 — and the seat gate then sized itself on the 2.
        // The snapshot now reports slotsVerified:false for exactly this case.
        log.warn(
            `Ollama was ALREADY RUNNING on ${alreadyUp.join(', ')} — this farm did not start it, so its ` +
            `concurrency/KV settings below are NOT applied (capacity + seats are unverified). ` +
            `Set these on the Ollama service and restart it to make them real:`
        );
        log.plain(
            `     OLLAMA_NUM_PARALLEL=${config.ollama.numParallel} ` +
            `OLLAMA_MAX_LOADED_MODELS=${config.ollama.maxLoadedModels} ` +
            `OLLAMA_FLASH_ATTENTION=${config.ollama.flashAttention ? 1 : 0} ` +
            (config.ollama.flashAttention && config.ollama.kvCacheType && config.ollama.kvCacheType !== 'f16'
                ? `OLLAMA_KV_CACHE_TYPE=${config.ollama.kvCacheType} ` : '') +
            `OLLAMA_KEEP_ALIVE=${config.ollama.keepAlive} ` +
            `OLLAMA_CONTEXT_LENGTH=${typeof config.ollama.contextLength === 'number' ? config.ollama.contextLength : 16384}`
        );
    }
    // numParallel: what the daemon runs until the farm restarts (its env applies only
    // at start) — a live slot change writes the config, not this.
    return { reachable, spawnedPids, unmanagedHosts: alreadyUp, numParallel: config.ollama.numParallel };
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
                    let last = ''; let lastAt = 0;
                    await ollama.pullModel(host, upstream, (o) => {
                        // pullModel emits the PARSED object now, so format it here — and
                        // throttle: with byte counts the text changes on every chunk.
                        const s = ollama.pullProgressText(o);
                        const now = Date.now();
                        if (s !== last && now - lastAt >= 400) {
                            last = s; lastAt = now;
                            process.stdout.write(`\r${log.paint.grey(`[${label}]`)} ${s}            `);
                        }
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
                const params = ollama.deriveParams(config, m);
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
        for (const pid of [existing.searxngPid, existing.kokoroPid, existing.extractPid, existing.embedPid, existing.llamacppPid, ...(existing.ollamaPids || [])]) {
            if (pid && isAlive(pid)) { try { await killTree(pid); } catch { /* already gone */ } }
        }
        clearRuntime();
    }

    // The job and download slots (makeJobs). They exist from the start; the beacon's kick is wired once it does.
    const kickBox = { fn: () => {} };
    const jobs = makeJobs({ kick: () => kickBox.fn() });
    const { serialize } = jobs;

    log.info(`Bringing up ${log.paint.bold(config.name)} …`);

    // 0b. Detect hardware FIRST — the llama.cpp VRAM budget needs it before spawn
    //     (it used to be detected only when the snapshot was built, long after).
    const hw = await detectHardware();
    // Document search's 'auto': on with an NVIDIA GPU this farm can run it on (in memory, for this run).
    if (config.embed.enabled === 'auto') {
        embedMod.resolveEnabled(config, hw);
        log.info(`Document search: ${config.embed.enabled ? 'on' : 'off'} ${log.paint.grey(`(automatic: ${config.embed.enabled ? 'an NVIDIA GPU' : embedMod.available(config).message || 'no NVIDIA GPU'})`)}`);
    }

    // 0c. Can this platform run the llama.cpp engine at all? No prebuilt asset and
    //     no binDir means the answer is no (linux-arm64 — the DGX Spark — today), and
    //     the farm must FALL BACK to the Ollama engine instead of exiting: this exact
    //     hard-exit is what made the DGX box "not launch at all". In-memory only —
    //     the operator's config keeps llamacpp.enabled, so a later build (or a binDir)
    //     re-enables it without anyone re-editing anything.
    // 0c-bis. External engine (vLLM/SGLang/… — see ExternalSchema). We do not run
    //     it, so the only question at boot is whether it ANSWERS. If it does it
    //     takes the box (exclusive, so llama.cpp stands down); if it does not, fall
    //     back exactly like a failed llama.cpp boot rather than refusing to start —
    //     a farm that dies because an operator-run backend is down serves nobody.
    let externalBootError = null;
    if (config.external.enabled) {
        const ok = await externalAlive(config.external);
        if (ok) {
            log.ok(`External engine: ${log.paint.bold(config.external.alias)} via ${log.paint.cyan(config.external.baseUrl)} ${log.paint.grey('(operator-run — this farm routes to it, never restarts it)')}`);
            // A vLLM says what it really allocated: warn now when the declared seats
            // cannot all hold their window (the panel repeats it on the Performance card).
            const v = perfMod.vllmSample(await llamacpp.fetchMetrics(perfMod.metricsUrlFor(config.external.baseUrl), 3000, externalHeaders(config.external)), Date.now());
            if (v) {
                log.ok(`It is a vLLM — its /metrics feed the live load and the Performance card${v.poolTokens ? ` (context memory: ${v.poolTokens.toLocaleString('en-US')} tokens)` : ''}.`);
                const short = perfMod.poolShortfall(config.external.parallel, config.external.contextLength, v.poolTokens);
                if (short) log.warn(short);
            }
            if (config.llamacpp.enabled) {
                log.info('llama.cpp stands down — one engine at a time.');
                config.llamacpp.enabled = false;
            }
        } else {
            externalBootError = `External engine at ${config.external.baseUrl} is not answering — serving with the built-in engine instead. Start it and re-run \`lol up\` (or restart the farm) to use it.`;
            log.warn(externalBootError);
            logFallbackNames(engineFallback(config, 'external'));
        }
    }

    // 0c-ter. vLLM run by the farm (docs/VLLM_MANAGED_PLAN.md). The farm's boot never waits for vLLM (D5): the
    //     proxy, gate, panel and beacon come up in seconds and a start runs as the job "Starting vLLM", during
    //     which the farm stays healthy and says busy (clients keep it), and the gate answers "starting".
    //     a) The orphan rule: a vLLM this farm started (its marker) that still runs from its root while another
    //        engine is chosen was left by a crash in the middle of a switch: stop it, or two engines share a GPU.
    //        One without the marker is someone else's and is left alone.
    //     b) vLLM is the engine: check this computer once (cached; never per panel poll), then keep a server
    //        that already runs with these settings (a farm crash, a Farm app restart: D4, adopted at once), wait
    //        for one that is starting, or queue the start. What blocks it (not installed, no model, WSL) serves
    //        with Ollama for this run, with the reason on the panel.
    // One engine at a time, in memory too: a file with vLLM and llama.cpp both on (llama.cpp served before an
    // operator's vLLM, which a take-over then made the farm's) serves vLLM, and llama.cpp stands down for this run
    // instead of starting beside it (in memory only, as an external server's stand-down above).
    if (engineOf(config) === 'vllm' && config.llamacpp.enabled) {
        log.info('llama.cpp stands down — one engine at a time.');
        config.llamacpp.enabled = false;
    }
    const vllmSup = vllmMod.supported();
    // What Windows itself sees (its own nvidia-smi, read at boot): the check says "too small" or "no NVIDIA GPU" before
    // anything about WSL (vllm.problemsFrom). Read again at each check while nvidia-smi has not answered (checkVllm).
    const hostGpu = vllmMod.hostGpuOf(hw);
    let vllmProbe = null;          // the last check (vllm.probe), refreshed after a start, a stop, a download
    let vllmTarget = null;         // {platform, distro, root, port} where it lives (vllm.targetOf)
    let vllmBootError = null;
    let vllmBootErrorRan = false;  // that reason came from vLLM running (a start, a crash): its log says more
    let vllmBootJob = null;        // 'start' | 'restart' | 'wait', run once the farm is public
    let vllmChild = null;          // the serve.sh the farm spawned (wsl.exe on Windows), null when adopted or stopped
    let takeOverOffer = null;      // "Let the farm run vLLM" (§9): what the panel offers (vllm.takeOverPlan), or null
    let takeOverDone = null;       // what the take-over replaced: the panel's Undo, until a setting changes or a restart
    // phase: starting (planned) | ready | down (not answering, being checked) | restarting (after an unplanned
    // stop) | stopping | stopped (the operator's Stop, a cancelled start) | guard | failed (fell back to Ollama).
    const vllmState = {
        phase: null, text: null, percent: null, adopted: false, startedAt: null, poolTokens: null, peopleFit: null,
        weightsGib: null, lastRestartAt: null, launchSettings: null, misses: 0, guardLine: null,
    };
    const staleVllm = existing && existing.vllm;
    if (vllmSup.ok && engineOf(config) !== 'vllm' && (config.vllm.root || (staleVllm && staleVllm.root))) {
        const t = {
            platform: process.platform, port: config.vllm.port,
            root: config.vllm.root || staleVllm.root, distro: config.vllm.distro || (staleVllm && staleVllm.distro) || null,
        };
        const s = await vllmMod.status(t);
        if (vllmMod.isOrphan(engineOf(config), s.st)) {
            log.step(`Stopping a vLLM left running from ${s.st.root} …`);
            const r = await vllmMod.stop({ ...t, root: s.st.root }, { alive: () => vllmMod.answers(`http://127.0.0.1:${t.port}/v1`, 2000) });
            if (r.ok) log.ok(`Stopped a vLLM left running from ${s.st.root}: this farm serves with ${engineOf(config) === 'llamacpp' ? 'llama.cpp' : engineOf(config) === 'external' ? 'an external server' : 'Ollama'} now.`);
            else log.warn(`A vLLM left running from ${s.st.root} did not stop: ${r.error}`);
        }
    }
    if (engineOf(config) === 'vllm') {
        let why = null;
        if (!vllmSup.ok) why = vllmMod.UNSUPPORTED;
        else {
            log.step('vLLM: checking this computer …');
            vllmProbe = await vllmMod.probe(config, { hostGpu });
            vllmTarget = vllmMod.targetOf(config, vllmProbe);
            const st = vllmProbe.st;
            // A download left running by a farm that crashed: this run tracks none, so stop it (Download goes on
            // from the files it finished).
            if (st && st.installing && vllmTarget) {
                log.step('Stopping a vLLM download left running by the last farm (Download continues it) …');
                await vllmMod.stopInstall(vllmTarget);
                st.installing = null;
            }
            const pr = vllmMod.problemsFrom(vllmProbe, config);
            const mem = st ? vllmMod.memOf(st) : { unified: false };
            const running = st && st.running;
            const adopt = running ? vllmMod.adoptable(config, running, { unified: mem.unified, gpuName: st.gpu && st.gpu.name, root: vllmTarget.root }) : null;
            // No answer at all (WSL still starting at log on): the start is queued, and checks again once the farm is up.
            const noAnswer = vllmMod.unanswered(vllmProbe) && !pr.gpuTooSmall;   // a GPU too small is an answer
            const d = vllmMod.bootDecision({ supported: vllmSup, problems: pr.problems, running, adopt, noAnswer });
            if (d.action === 'unavailable') {
                why = d.reason;
                // The farm's own vLLM (its marker) that runs with other settings leaves the GPU before Ollama loads.
                // One that does not stop keeps the farm on vLLM, stopped, saying why: never two engines on one GPU.
                if (running && st.managed && vllmTarget) {
                    log.step(`Stopping the vLLM running from ${vllmTarget.root}: it cannot serve as it is …`);
                    const r = await vllmMod.stop(vllmTarget, { alive: () => vllmMod.answers(vllmMod.baseUrl(config), 2000) });
                    if (!r.ok) {
                        log.err(r.error);
                        setVllmPhase('stopped', vllmStuckText(why, r.error));
                        why = null;
                    }
                }
            } else if (d.action === 'adopt') {
                adoptVllm(adopt.resolved);
                log.ok(`vLLM is already running from ${vllmTarget.root} with these settings: kept running (${config.vllm.parallelResolved} people at once).`);
            } else {
                if (running && !adopt.ok) log.info(`vLLM runs from ${vllmTarget.root} with other settings (${adopt.diff.join(', ')}): it restarts with this farm's.`);
                if (noAnswer) log.info('vLLM: this computer did not answer the check yet (WSL may still be starting): the start checks again once the farm is up.');
                vllmBootJob = d.action;
                setVllmPhase('starting', d.action === 'wait' ? 'starting vLLM' : null);
            }
        }
        if (why) {
            vllmBootError = why;
            log.warn(`vLLM: ${why} Serving with Ollama for now.`);
            logFallbackNames(engineFallback(config, 'vllm'));
        }
    }

    let llamacppBootError = null;
    if (engineOf(config) === 'llamacpp' && !config.llamacpp.binDir && !llamacpp.installed() && !llamacpp.supported()) {
        // Plain words on the panel (D10); the developer's way out (a llama.cpp built by hand, its folder in the
        // config) is in farm/README.md.
        llamacppBootError = 'Not available on this computer: there is no ready-made llama.cpp for it. The farm serves with Ollama.';
        log.warn(`${llamacppBootError} (${process.platform}/${process.arch})`);
        logFallbackNames(engineFallback(config, 'llamacpp'));
    }

    // 1. Ollama
    const oll = await ensureOllama(config);
    if (!oll) return 1;
    // The models on this box's own Ollama: which one reads documents beside another engine (resolveOcrModel).
    // Read again after a pull or a removal.
    let ocrInstalled = [];
    const readOcrInstalled = async () => {
        const names = [];
        for (const h of oll.reachable.filter(isLocalHost)) names.push(...await ollama.listModels(h));
        ocrInstalled = names;
    };
    await readOcrInstalled();

    // 1b. Choose which installed model(s) to serve (interactive picker, or
    //     --model / --no-pick / non-TTY → the configured catalog). Drives THIS run.
    // The interactive picker chooses what OLLAMA serves. With the llama.cpp engine
    // on, the catalog is standby inventory (nothing in it is routed), so prompting
    // "which models to serve" would promise something the run will not do.
    if (ollamaServes(config)) {
        config.models = await selectModels(config, oll.reachable, args || []);
    }

    // 2. Models — pull any chosen model a host is missing (no-op for picked ones).
    await pullMissing(config, oll.reachable);

    // The farm's plugins (registry.js). Most start at 4b below; Document search, which holds GPU memory, starts here
    // when it is on disk: BEFORE llama.cpp measures the free memory and Ollama's context probe loads the model, so
    // both size themselves around it (owner, 2026-10-08). A first download starts it late instead, once the farm is
    // public. While it runs, vLLM's Automatic memory finds it already taken (embedReserveGib).
    const services = makeServices();
    const svcById = Object.fromEntries(services.map((s) => [s.id, s]));
    const pluginRuntime = { log, pluginKey, resolveOcrModel: (c) => resolveOcrModel(c, ocrInstalled), isLocalHost, reachable: oll.reachable };
    for (const svc of services) {
        if (!svc.enabled(config) || !svc.isEarly(config)) continue;
        const res = await svc.start(config, pluginRuntime);
        if (res && res.level && res.message) log[res.level](res.message);
    }
    // What vLLM's Automatic memory keeps for Document search: its share while it is on but not running yet (a toggle
    // from the panel, a start that is still downloading), nothing once its memory is taken.
    const embedReserveGib = () => (svcById.embed.enabled(config) && !svcById.embed.up ? embedMod.RESERVE_GIB : 0);
    // Plugins started before the farm is public go down with a boot that gives up.
    const stopServices = async () => { for (const svc of services) { if (svc.pid) await killTree(svc.pid); } };

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

    // VRAM free for llama.cpp, measured each time it is sized (startLlamacpp) — null
    // until then, or when nvidia-smi cannot say (unified memory): the whole card.
    let vramFreeGb = null;
    async function measureVramFreeGb() {
        // startLlamacpp only runs with no llama-server of ours alive, but one stopped a
        // moment ago may still be handing its memory back: read until it stops rising.
        const free = await untilSteady(gpuFreeGb);
        if (free == null) return null;
        // The farm's OWN Ollama models are not co-tenants: the pressure eviction frees
        // them for llama.cpp (a switch from Ollama leaves its default loaded for good).
        let ollamaGb = 0;
        for (const h of (oll.reachable || []).filter(isLocalHost)) {
            for (const m of await ollama.psModels(h)) ollamaGb += (m.sizeVram || 0) / 1024 ** 3;
        }
        return Math.round((free + ollamaGb) * 10) / 10;
    }

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
                : (config.llamacpp.model ? ollama.ggufPathFor(llamacpp.normalizeModelUrl(config.llamacpp.model)) : null);
            if (!mp || !fsMod.existsSync(mp)) return null;
            const meta = modelMeta(mp);
            // Split models: shard 1 (what llama-server is pointed at) can be a few
            // MB of metadata — the budget needs the sum of ALL shards on disk.
            const weightsGb = llamacpp.weightsBytesFor(mp) / 1e9;
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
                freeGb: vramFreeGb, reserveGb: config.llamacpp.gpuReserveGb,
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
                // What llama.cpp may use of the GPU (free at its last start, less the
                // reserve) — what every "this GPU has N GB" message must compare with.
                vramGb: budget.usableGb ?? ((hw && hw.vramGb) || null),
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

    // Native context max of the DEFAULT Ollama model — the panel's context
    // dropdown adapts to it (a 1M-native model must OFFER 1M; a 32k model must
    // not offer 262k). showModel is a network call and adminState polls every
    // 1-5 s, so this memoizes per model id and refreshes in the background: the
    // poll that changes the default gets null, the next one gets the answer.
    const ollamaNative = { id: null, max: null, inflight: false };
    function ollamaNativeMax() {
        const def = (config.models.find((m) => m.default) || config.models[0] || {}).id || null;
        if (!def) return null;
        if (ollamaNative.id === def) return ollamaNative.max;
        if (!ollamaNative.inflight) {
            ollamaNative.inflight = true;
            const host = (oll.reachable || []).filter(isLocalHost)[0] || (oll.reachable || [])[0] || null;
            (host ? ollama.showModel(host, def) : Promise.resolve(null))
                .then((meta) => { ollamaNative.id = def; ollamaNative.max = (meta && meta.contextLength) || null; })
                .catch(() => { ollamaNative.id = def; ollamaNative.max = null; })
                .finally(() => { ollamaNative.inflight = false; });
        }
        return ollamaNative.id === def ? ollamaNative.max : null;
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
        // kvCacheType is part of the key: q8_0 halves the per-token cost, so a
        // verdict probed under one cache type must never be served under another.
        // The parallel count is the one the daemon RUNS (oll.numParallel): after a
        // live slot change the probe still loads on the old daemon, and filing that
        // verdict under the new count let the restart reuse a window measured for
        // fewer people (KV spilling to RAM). The restart sizes the new count on a
        // daemon that runs it.
        // Document search running beside it holds ~1.2 GB of the GPU: a verdict measured without it would not fit with it.
        const cacheKey = `${def}|${vram ?? '?'}|${oll.numParallel}|${config.ollama.kvCacheType || 'f16'}${svcById.embed.up ? '|embed' : ''}`;
        let cache = {};
        try { cache = JSON.parse(fsMod.readFileSync(cacheFile, 'utf8')) || {}; } catch { /* first probe */ }
        if (typeof cache[cacheKey] === 'number') {
            config.ollama.contextResolved = cache[cacheKey];
            log.ok(`Context: auto → ${log.paint.bold(String(cache[cacheKey]))} tokens ${log.paint.grey(`(cached probe: ${def} on this box)`)}`);
            return cache[cacheKey];
        }
        const meta = await ollama.showModel(host, def);
        const native = (meta && meta.contextLength) || null;
        ollamaNative.id = def; ollamaNative.max = native;   // seed the panel's dropdown memo
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
        // Ceiling = the MODEL'S OWN max (the old hard 262144 quietly halved every
        // long-context model — live case: a 1M-native model); ~8% VRAM headroom
        // for the desktop. The budget line + verify-load still referee.
        const cap = Math.max(16384, native || 262144);
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
        //     min(model native max, what fits the VRAM free right now), read from the
        //     real files and nvidia-smi — another app's share of the GPU is not ours.
        //   a number → honored, clamped (and the clamp persisted) if it cannot fit.
        // Ollama's models leave the GPU first: a switch from Ollama leaves its default loaded for good (§1.4).
        await evictOllama(onProgress);
        vramFreeGb = await measureVramFreeGb();
        const fit = computeFit(16384);   // maxContext is independent of the request
        if (config.llamacpp.contextLength === 'auto') {
            const target = autoLlamacppContext(fit);
            config.llamacpp.contextResolved = target;
            const why = [
                fit && fit.nativeMax ? `model max ${fit.nativeMax}` : 'model max unknown',
                fit && fit.vramGb ? `budget for ${fit.vramGb} GB${hw && hw.vramGb > fit.vramGb ? ` of the GPU's ${hw.vramGb} (the rest in use or reserved)` : ''}` : null,
            ].filter(Boolean).join(', ');
            log.ok(`Context: auto → ${log.paint.bold(String(target))} tokens ${log.paint.grey(`(${why})`)}`);
        } else {
            const target = config.llamacpp.contextLength;
            // A pinned number that overflows VRAM is HONORED, loudly (owner call
            // 2026-08-28: the admin may deliberately trade speed for window — the
            // boot used to clamp+persist, which silently undid that choice).
            if (fit && fit.maxContext != null && fit.maxContext >= 4096 && target > fit.maxContext) {
                log.warn(`Context ${target} needs ~${computeFit(target).needGb} GB — this GPU has ${fit.vramGb} GB free for it. ` +
                    `Honoring it (explicitly configured), but part of the model will live in system RAM: expect a few tokens/second. ` +
                    `${fit.maxContext} is the largest that fits; "auto" picks it for you.`);
            }
            config.llamacpp.contextResolved = target;
        }
        const child = llamacpp.spawnLlamacpp(config, mdl.modelPath, mdl.mmprojPath, binDir);
        // Keep the child's recent lines so a startup death can QUOTE the real error
        // (explainEngineFailure) instead of guessing at the cause.
        const lastLines = [];
        const tapLines = () => {
            const fwd = log.childPrefix('llama.cpp');
            return (d) => {
                fwd(d);
                for (const l of String(d).split(/\r?\n/)) {
                    if (!l.trim()) continue;
                    lastLines.push(l);
                    if (lastLines.length > 80) lastLines.shift();
                }
            };
        };
        child.stdout.on('data', tapLines());
        child.stderr.on('data', tapLines());
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
            return { ok: false, message: llamacpp.explainEngineFailure(lastLines) };
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
            logFallbackNames(engineFallback(config, 'llamacpp'));
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

    // Before vLLM or llama.cpp starts, every model loaded on a local Ollama leaves the GPU (a switch from Ollama
    // leaves its default loaded with keep_alive -1), then the free memory is read until it stops rising
    // (measureVramFreeGb). Document reading reloads its model on demand, in the memory kept for it.
    async function evictOllama(progress = () => {}) {
        let n = 0;
        for (const h of (oll.reachable || []).filter(isLocalHost)) {
            for (const m of await ollama.psModels(h)) { if (await ollama.evictModel(h, m.name)) n++; }
        }
        if (!n) return;
        progress('freeing the GPU memory Ollama used', null);
        await measureVramFreeGb();
    }

    // ---- vLLM, run by the farm: the lifecycle (docs/VLLM_MANAGED_PLAN.md §1.5, §5) --------------------------
    // vllm.js runs the scripts and decides; this is the glue. Health by phase (§1.5): a PLANNED start (boot, Start,
    // switch, Apply) keeps the farm healthy and says busy, and the gate answers "starting" (clients keep their farm
    // instead of scattering to slower ones); only an unplanned death, the operator's Stop and the memory guard
    // make the farm unhealthy, so clients fail over.
    let liveReady = false;   // liveHealth exists (it is built once the proxy is up)
    const vllmAlive = (ms = 3000) => vllmMod.answers(vllmMod.baseUrl(config), ms);
    const vllmReady = () => engineOf(config) === 'vllm' && vllmState.phase === 'ready';
    function setVllmPhase(phase, text = null, percent = null) {
        vllmState.phase = phase; vllmState.text = text; vllmState.percent = percent; vllmState.misses = 0;
    }
    function setEngineUp(v) {
        if (liveReady) liveHealth.engineUp = v;
        kickBox.fn();
    }
    async function checkVllm() {
        if (!hostGpu.name) Object.assign(hostGpu, vllmMod.hostGpuOf(await detectHardware()));   // nvidia-smi slow at boot
        vllmProbe = await vllmMod.probe(config, { hostGpu });
        const t = vllmMod.targetOf(config, vllmProbe);
        if (t) vllmTarget = t;
        return vllmProbe;
    }
    // Keep a server that runs with these settings (D9): what it was launched with becomes this run's numbers.
    function adoptVllm(resolved) {
        const v = config.vllm;
        v.parallelResolved = resolved.seats; v.maxNumSeqsResolved = resolved.maxNumSeqs; v.kvResolvedGib = resolved.kvGib;
        vllmState.launchSettings = { ...vllmMod.settingsOf(config, vllmTarget.root), kvGib: resolved.kvGib, maxNumSeqs: resolved.maxNumSeqs, seats: resolved.seats };
        vllmState.adopted = true; vllmState.startedAt = Date.now();
        setVllmPhase('ready');
    }
    function enterGuard(line, message = null) {
        vllmState.guardLine = line || null;
        const msg = message || vllmMod.explainFailure(3, line || '');
        setVllmPhase('guard', msg);
        setEngineUp(false);
        log.err(msg);
    }
    // The serve.sh the farm spawned: its end while vLLM is ready is a crash (a start reads it itself, in waitReady).
    function watchVllmChild(child) {
        child.once('exit', (code) => {
            if (vllmChild !== child) return;   // stopped on purpose (stopVllmProcess nulls it first), or replaced
            vllmChild = null;
            if (vllmState.phase !== 'ready') return;
            if (code === 3) return enterGuard(null);
            onVllmDown('it shut down by itself', `status ${code}`);
        });
    }
    // Stop vLLM (vllm.stop: stop.sh, until nothing runs and the port is quiet). `portWait: false` when what answers
    // on the port is known to be another program's (it held the port before vLLM could): only this root counts.
    // → {ok, error}.
    async function stopVllmProcess({ portWait = true } = {}) {
        if (!vllmTarget) return { ok: true, error: null };
        const child = vllmChild;
        vllmChild = null;   // identity guard first: this exit is not a crash
        const r = await vllmMod.stop(vllmTarget, { alive: portWait ? () => vllmAlive(2000) : null });
        if (!r.ok && child && child.exitCode === null && child.signalCode === null) vllmChild = child;   // still ours
        return r;
    }

    // Start vLLM with the current settings (§5.2), each step refusing with its reason before anything is stopped
    // where it can. `waitOnly`: a start found in progress at boot, waited for without spawning. → {ok, message,
    // code, cancelled}.
    async function startVllm(progress = () => {}, { isCancelled = () => false, phase = 'starting', waitOnly = false } = {}) {
        // Never while the farm stops (a `lol down` met in the middle of an Apply): a vLLM spawned now would outlive it.
        const quitting = () => (stopping ? { ok: false, message: 'The farm is stopping.' } : null);
        if (quitting()) return quitting();
        const dl = jobs.downloading();
        if (dl && dl.kind === 'install') return { ok: false, message: 'vLLM is being installed: wait for it, or stop it.' };
        const say = (text, pct = null) => { setVllmPhase(phase, text, pct); progress(text, pct); };
        vllmState.adopted = false; vllmState.poolTokens = null; vllmState.peopleFit = null; vllmState.weightsGib = null;
        let plan = null; let child = null; let fromByte = 0;
        // Ollama's loaded models leave the GPU first, for a start found in progress too (a farm that crashed while
        // vLLM started, a take-over of one still starting): a fallback before it left Ollama's default loaded for good.
        await evictOllama(say);
        if (!waitOnly) {
            say('checking this computer');
            await checkVllm();
            if (vllmProbe.st && vllmProbe.st.running) {
                const st = vllmProbe.st;
                const a = vllmMod.adoptable(config, st.running, { unified: vllmMod.memOf(st).unified, gpuName: st.gpu && st.gpu.name, root: vllmTarget.root });
                // Already running with these settings, ready and answering (a check that missed it at boot): kept.
                if (vllmMod.keepRunning({ running: st.running, adopt: a, answers: await vllmAlive(3000) })) {
                    adoptVllm(a.resolved);
                    vllmBootError = null;
                    if (liveReady) liveHealth.engineFallbackReason = null;
                    setEngineUp(true);
                    log.ok(`vLLM is already running from ${vllmTarget.root} with these settings: kept running (${config.vllm.parallelResolved} people at once).`);
                    return { ok: true };
                }
                say('stopping the vLLM that runs now, to start it again');
                const s = await stopVllmProcess();
                if (!s.ok) return { ok: false, message: s.error };
                await checkVllm();
            }
            // Automatic memory is sized against what is free now: a vLLM stopped a moment ago (an Apply, a restart, a
            // Start after Stop) can still be handing its memory back, under WSL most. Read until it stops rising.
            if (config.vllm.kvCacheGib === 'auto' && vllmProbe.st) {
                let first = true;
                await untilSteady(async () => {
                    if (!first) await checkVllm();
                    first = false;
                    const m = vllmProbe.st && vllmMod.memOf(vllmProbe.st);
                    return m ? (m.unified ? m.memAvailableGib : m.freeGib) : null;
                }, { gapMs: 1500 });
            }
            const pr = vllmMod.problemsFrom({ ...vllmProbe, installKind: dl ? dl.kind : null }, config);
            if (pr.problems.length || !vllmTarget) return { ok: false, message: pr.problems[0] || 'This computer did not answer the check.' };
            if (isCancelled()) return { ok: false, cancelled: true };
            plan = vllmMod.planFor(config, vllmProbe.st, vllmMod.memOf(vllmProbe.st), { embedReserveGib: embedReserveGib() });
            if (!plan.ok) return { ok: false, message: plan.reason };
            // Nothing of this root runs now (stopped just above), so whatever answers on the port is another program's:
            // serve.sh's relay could not listen, and the start must not take that server's answers for its own.
            if (await vllmAlive(2000)) {
                return { ok: false, portIsOthers: true, message: vllmMod.explainFailure(1, ['relay could not listen'], { root: vllmTarget.root, port: config.vllm.port }) };
            }
            if (!config.vllm.root) { config.vllm.root = plan.root; persist('vllm', { root: plan.root }); }   // used once: remembered
            if (quitting()) return quitting();
            log.step(`vLLM: starting ${plan.entry.label} from ${plan.root} — ${plan.seats} people at once, ${plan.kvGib} GB for conversations …`);
            say('starting vLLM');
            ({ child, fromByte } = await vllmMod.start(vllmTarget, plan));
            vllmChild = child;
            watchVllmChild(child);
        } else {
            say('starting vLLM');
            fromByte = Math.max(0, (await vllmMod.readLog(vllmTarget, { fromByte: 0, maxBytes: 1 })).size - 256 * 1024);
        }
        const r = await vllmMod.waitReady(vllmTarget, {
            child, fromByte, isCancelled,
            alive: () => vllmAlive(3000),
            isDead: async () => { const s = await vllmMod.status(vllmTarget); return !!(s.st && !s.st.running); },
            isReady: async () => { const s = await vllmMod.status(vllmTarget); return !!(s.st && s.st.running && s.st.running.ready); },
            onPhase: (p) => {
                if (p.poolTokens != null) vllmState.poolTokens = p.poolTokens;
                if (p.peopleFit != null) vllmState.peopleFit = p.peopleFit;
                if (p.weightsGib != null) vllmState.weightsGib = p.weightsGib;
                if (p.key && p.key !== 'exited' && p.key !== 'ready') say(p.text, p.percent);
            },
            onLine: log.childPrefix('vllm'),
        });
        if (!r.ok) {
            if (r.cancelled || isCancelled()) {   // a Stop whose stop ended the child before waitReady looked again
                // A stop in the first second can come before serve.sh wrote its group: stop until the child is gone.
                for (let i = 0; i < 4 && child && child.exitCode === null && child.signalCode === null; i++) {
                    await stopVllmProcess();
                    await sleepMs(2000);
                }
                return { ok: false, cancelled: true };
            }
            for (const l of r.lines.filter((x) => /\bERROR\b|Error\b|Traceback|\[guard\]/.test(x)).slice(-6)) log.childPrefix('vllm')(l);
            // serve.sh's relay could not listen: another program held the port, and still answers there.
            const portIsOthers = r.lines.some((l) => /relay could not listen/.test(l));
            if (r.code !== 3) await stopVllmProcess({ portWait: !portIsOthers });   // nothing half-alive keeps the GPU (the guard stopped it already)
            const after = (await checkVllm()).st;
            const otherGpuGb = after && after.gpu && after.gpu.totalGib != null && after.gpu.freeGib != null ? after.gpu.totalGib - after.gpu.freeGib : null;
            return {
                ok: false, code: r.code, portIsOthers, ran: true,
                message: vllmMod.explainFailure(r.code, r.lines, { root: vllmTarget.root, port: config.vllm.port, label: (vllmMod.vllmEntry(config) || {}).label, otherGpuGb }),
            };
        }
        if (waitOnly) {
            const st = (await checkVllm()).st;
            const a = st && st.running ? vllmMod.adoptable(config, st.running, { unified: vllmMod.memOf(st).unified, gpuName: st.gpu && st.gpu.name, root: vllmTarget.root }) : null;
            if (!a || !a.resolved) return { ok: false, message: 'vLLM was starting, but the farm could not read its settings. Press Start vLLM.' };
            const fit = vllmState.peopleFit;
            adoptVllm(a.resolved);
            vllmState.peopleFit = fit;
        } else {
            const v = config.vllm;
            v.parallelResolved = plan.seats; v.maxNumSeqsResolved = plan.maxNumSeqs; v.kvResolvedGib = plan.kvGib;
            vllmState.launchSettings = { ...plan.settings, kvGib: plan.kvGib, maxNumSeqs: plan.maxNumSeqs, seats: plan.seats };
            if (vllmState.peopleFit == null) vllmState.peopleFit = plan.peopleFit;
            vllmState.startedAt = Date.now();
            setVllmPhase('ready');
        }
        vllmBootError = null;
        if (liveReady) liveHealth.engineFallbackReason = null;
        setEngineUp(true);
        log.ok(`vLLM is ready on :${config.vllm.port} — ${config.vllm.parallelResolved} people at once${vllmState.peopleFit != null ? `, room for ${vllmState.peopleFit} whole conversations` : ''}.`);
        return { ok: true };
    }

    // vLLM could not serve and did not stop either: what the panel says. Ollama never loads beside it.
    function vllmStuckText(reason, error) {
        const bare = (s) => String(s || '').trim().replace(/[.\s]+$/, '');
        return `${bare(reason)}. The farm could not stop what is left of it (${bare(error)}), so it does not start Ollama beside it: press Start vLLM to try again, or switch to another engine.`;
    }

    // vLLM failed for good this run: Ollama serves (in memory only, under vLLM's name; the file keeps vLLM, so
    // the next farm start tries again), with the reason on the panel.
    // The farm says healthy again only once LiteLLM routes to Ollama: a client told "healthy" earlier would get the
    // gate's 502 while the proxy restarts (found by the lifecycle test).
    // vLLM is stopped FIRST: one that does not stop keeps the farm on vLLM, stopped and saying why, rather than
    // loading Ollama's model beside it (two engines on one GPU). `portIsOthers`: the start found another program
    // on vLLM's port, which keeps answering there and is not vLLM. `ran`: vLLM ran (its log says more about `reason`),
    // as opposed to a start that stopped at its check. → true when Ollama serves now.
    async function fallbackToOllama(reason, { portIsOthers = false, ran = false } = {}) {
        if (stopping) return false;   // the farm stops: nothing loads into Ollama on its way out
        setEngineUp(false);
        const s = await stopVllmProcess({ portWait: !portIsOthers });
        if (!s.ok) {
            const text = vllmStuckText(reason, s.error);
            log.err(`vLLM: ${text}`);
            setVllmPhase('stopped', text);
            writeRuntimeState();
            return false;
        }
        vllmBootError = reason; vllmBootErrorRan = ran;
        log.warn(`vLLM: ${reason} Serving with Ollama for now.`);
        logFallbackNames(engineFallback(config, 'vllm'));
        await resolveOllamaContext();
        await restartProxy();
        await refreshOcrModel();
        setVllmPhase('failed', reason);
        if (liveReady) liveHealth.engineFallbackReason = reason;
        setEngineUp(null);
        writeRuntimeState();
        return true;
    }

    // A start as the job everyone sees ("Starting vLLM"); Stop cancels it. A failure falls back to Ollama, except
    // the memory guard's (never restarted, never a fallback: the operator frees memory and presses Start).
    function startVllmJob(label, { phase = 'starting', waitOnly = false } = {}) {
        if (phase === 'starting') setVllmPhase('starting', 'starting vLLM');
        return runJob('engine', label, async (progress, ctl) => {
            const r = await startVllm(progress, { isCancelled: ctl.cancelled, phase, waitOnly });
            if (r.ok) return { ok: true, message: 'vLLM is ready.' };
            if (r.cancelled) {
                setVllmPhase('stopped');
                setEngineUp(false);
                return { ok: false, error: 'Stopped. vLLM is not running: press Start vLLM.' };
            }
            if (r.code === 3) { enterGuard(null, r.message); return { ok: false, error: r.message }; }
            if (!(await fallbackToOllama(`vLLM could not start: ${r.message}`, { portIsOthers: !!r.portIsOthers, ran: !!r.ran }))) return { ok: false, error: vllmState.text };
            return { ok: false, error: `vLLM could not start: ${r.message} The farm serves with Ollama for now.` };
        }, { cancel: () => stopVllmProcess() });
    }

    // vLLM stopped answering, or its process ended (§5.7): look before acting. A server that is running and ready
    // and whose port answers was only slow; the memory guard's stop is never undone; otherwise ONE restart, and a
    // second stop within 5 minutes falls back to Ollama. In serialize, which downloads never hold. `why` is said to
    // the operator, in plain words (the fallback's reason); `detail` goes to the farm's log only.
    // A `lol down` from another shell (the Farm app's Quit) clears the runtime file, then stops vLLM: that stop is
    // not a crash to restart (a restarted vLLM would outlive the Quit), so the farm stops as it was asked.
    let vllmDownRunning = false;
    const downAsked = () => {
        if (readRuntime()) return false;
        log.info('vLLM stopped and the runtime file of this farm is gone: `lol down` ran, so the farm stops too.');
        shutdown('lol down');
        return true;
    };
    function onVllmDown(why, detail = null) {
        if (stopping || vllmDownRunning || engineOf(config) !== 'vllm') return;
        if (downAsked()) return;
        vllmDownRunning = true;
        log.err(`vLLM stopped answering: ${why}${detail ? ` (${detail})` : ''}.`);
        setVllmPhase('down');
        setEngineUp(false);
        serialize(async () => {
            if (stopping || engineOf(config) !== 'vllm' || vllmState.phase !== 'down') return;   // handled meanwhile
            if (downAsked()) return;
            const st = vllmTarget ? (await vllmMod.status(vllmTarget)).st : null;
            const decision = vllmMod.downDecision({
                guard: !!(st && st.guardLine), running: !!(st && st.running), ready: !!(st && st.running && st.running.ready),
                portAnswers: await vllmAlive(15000), lastRestartAt: vllmState.lastRestartAt,
            });
            if (decision === 'none') {
                log.info('vLLM was only slow: it runs and answers, nothing to do.');
                setVllmPhase('ready');
                setEngineUp(true);
            } else if (decision === 'guard') enterGuard(st.guardLine);
            else if (decision === 'fallback') await fallbackToOllama(`vLLM stopped working twice in 5 minutes (the second time, ${why}).`, { ran: true });
            else {
                vllmState.lastRestartAt = Date.now();
                const r = startVllmJob('Restarting vLLM after it stopped unexpectedly', { phase: 'restarting' });
                if (!r.ok) log.warn(`vLLM restarts once the farm is free: ${r.error}`);   // the watch tries again
            }
        }).finally(() => { vllmDownRunning = false; });
    }

    // Every 10 s while vLLM is ready and no job of its own runs: three misses in a row (10 s each, asked again at
    // once after a miss) and onVllmDown looks. A server that stays down while such a job held the farm is looked at
    // again after. Any other job (an Ollama download, a password) does not hide a vLLM that died: the farm says so
    // at once and clients go elsewhere; its restart (in serialize) waits for that job.
    const vllmJobRunning = () => busy() && ['engine', 'backend', 'settings'].includes((jobs.jobView() || {}).kind);
    function watchVllm(delayMs = 10000) {
        const t = setTimeout(async () => {
            if (stopping) return;
            let next = 10000;
            try {
                if (engineOf(config) === 'vllm' && !vllmJobRunning()) {
                    if (vllmState.phase === 'ready') {
                        if (await vllmAlive(10000)) vllmState.misses = 0;
                        else if (vllmState.phase === 'ready' && ++vllmState.misses >= 3) onVllmDown('it stopped answering for 30 seconds');
                        else if (vllmState.phase === 'ready') next = 0;
                    } else if (vllmState.phase === 'down' && !vllmDownRunning) onVllmDown('it still did not answer');
                }
            } catch { /* never throw from a timer */ }
            watchVllm(next);
        }, delayMs);
        if (t.unref) t.unref();
    }

    // Document reading follows the engine (§1.4): a change of its model restarts that plugin.
    async function refreshOcrModel() {
        const svc = svcById.ocr;
        if (!config.ocr.enabled || !svc || !svc.pid || !svc.ctx) return;
        const want = resolveOcrModel(config, ocrInstalled);
        if (svc.ctx.model === want) return;
        log.step(`Document reading now uses ${want} …`);
        await bringDown(svc);
        await bringUp(svc);
        writeRuntimeState();
    }

    // What the farm's vLLM target is in the runtime file, so `lol down` from another shell stops it and the next
    // `lol up` finds a vLLM left running (the orphan rule): while vLLM is the engine, or a download runs (recorded
    // again once it ends). `serving` says which: only the vLLM this farm serves with is the farm's to stop; a download
    // into a root someone else's vLLM runs from (an external server's, before the take-over) stops the download only.
    const vllmRuntime = () => {
        const serving = engineOf(config) === 'vllm';
        return (serving || jobs.downloading()) && vllmTarget
            ? { platform: vllmTarget.platform, distro: vllmTarget.distro, root: vllmTarget.root, port: vllmTarget.port, serving } : null;
    };

    // 2b. llama.cpp backend (the default). Runs INSTEAD of Ollama for its alias —
    //     LiteLLM skips the Ollama deployments for that model_name — because it is the
    //     only way to get speculative decoding on a 12 GB card (see LlamacppSchema).
    //     The client is unaffected: llama-server is OpenAI-compatible behind LiteLLM.
    if (engineOf(config) === 'llamacpp') {   // the engine that serves, never a flag left on beside another
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
            logFallbackNames(engineFallback(config, 'llamacpp'));
            await stopLlamacpp();
        }
    }

    // 2c. Ollama-engine context: with llama.cpp serving, no local Ollama is routed,
    //     so sizing would probe (and load a model) for nothing. When Ollama IS the
    //     engine — configured, unsupported platform, or boot fallback — resolve
    //     'auto' BEFORE the routing is generated so num_ctx carries the real number.
    if (ollamaServes(config)) {
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
    // Name the engine that is actually routed: with llama.cpp or an external
    // server serving, the Ollama catalog is standby and contributes no deployment.
    const routedWhat = {
        external: `external ${config.external.baseUrl}`,
        vllm: `vLLM :${config.vllm.port}`,
        llamacpp: `llama.cpp :${config.llamacpp.port}`,
    }[engineOf(config)] || `${config.models.length} model × ${config.ollama.hosts.length} host`;
    log.ok(`Generated LiteLLM routing → ${log.paint.grey(yamlPath)} (${routedWhat}${peers.length ? ` + ${peers.length} peer` : ''})`);
    if (ollamaServes(config)) {
        const def = servedEntries(config).find((e) => e.isDefault);
        if (def && def.servedName !== def.underlying) {
            log.ok(`Model alias: clients see ${log.paint.bold(`"${def.servedName}"`)} → ${log.paint.bold(def.underlying)} (switch the model anytime without breaking chats)`);
        }
    }

    // 4. Start + health-wait the proxy. With the seat gate on (default), the
    // public proxy.port is the farm's OWN listener (src/seats.js) and LiteLLM
    // binds loopback-only one port up — that puts the farm's Node process in
    // the serving path, which is the only place "idle people don't hold seats"
    // can actually be ENFORCED (presence pings can't block anything). Gate off
    // → LiteLLM binds the public port directly, exactly as before.
    const seatGateOn = config.proxy.seatGate !== false;
    const internalPort = seatGateOn ? (config.proxy.internalPort || config.proxy.port + 1) : config.proxy.port;
    const litellmBind = seatGateOn ? { port: internalPort, host: '127.0.0.1' } : {};
    // baseUrl is the farm's OWN LiteLLM check path — always talk to LiteLLM
    // directly, not through the gate (health checks must not consume seats and
    // must see LiteLLM itself, not the gate's 502 while it restarts).
    const baseUrl = `http://127.0.0.1:${internalPort}`;
    log.step(`Starting LiteLLM proxy on ${config.proxy.host}:${config.proxy.port} …${seatGateOn ? log.paint.grey(` (seat gate on — LiteLLM on loopback :${internalPort})`) : ''}`);
    // The gate is also what keeps LiteLLM's pass-through routes (/vllm/…, /azure/…) off the LAN: with an
    // external engine on hosted_vllm/ they reach the server with no seat and no password check of ours.
    if (!seatGateOn && config.external && config.external.enabled) {
        log.warn('proxy.seatGate is false with an external engine: LiteLLM answers the LAN directly, and its pass-through routes (/vllm/…) reach the engine unfiltered. Keep the seat gate on unless this LAN is yours alone.');
    }
    // `child` is a `let` so the admin control API can bounce the proxy in place
    // (restartProxy below) to change the served model set without a full `lol up`.
    let child = spawnLitellm(config, yamlPath, litellmBind);
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
    if (spawnFailed) { await stopServices(); return 1; }
    if (!up) {
        log.err('LiteLLM did not become healthy in time. Check the [litellm] logs above.');
        await killTree(child.pid);
        await stopServices();
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
    for (const svc of services) {
        // The late ones start once the farm is public; the early ones (Document search) already started, before the engine.
        if (!svc.enabled(config) || svc.isLate(config) || svc.isEarly(config)) continue;
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
        classifyUp: svcById.classify.up,      // advertise classify{} so the Computer's Classify box works
        classifyKey: svcById.classify.up ? svcById.classify.ctx.key : null,
        sttUp: svcById.stt.up,                // advertise stt{} so the Computer's Sound box can listen
        sttKey: svcById.stt.up ? svcById.stt.ctx.key : null,
        busUp: svcById.bus.up,                // advertise bus{} so boards and Computers meet here
        embedUp: svcById.embed.up,            // advertise embed{} so laptops index their documents here
        embedKey: svcById.embed.up ? svcById.embed.ctx.key : null,
        plugins: pluginsSummary(services, config), // generic map for the admin page + clients
        clientsConnected: 0,             // desktop clients heartbeating us (see onClientPing)
        // false when ANY reachable Ollama was already running before this farm
        // started: its concurrency/KV env is then whatever that service was
        // launched with, not our config, so backendInfo must not assert ours.
        ollamaManaged: !(oll.unmanagedHosts || []).length,
        ollamaUnmanagedHosts: oll.unmanagedHosts || [],
        host: hw,                        // static GPU/VRAM/RAM/cores (detected at boot)
        gpu: await gpuLiveStats(),       // live GPU util + VRAM (refreshed below)
        perf: null,                      // measured throughput (health timer, llama.cpp engine)
        // Boot outcome: llamacppChild exists iff the engine came up (fallback
        // cleared it). null = not the engine (Ollama mode / old farms). For the
        // external engine, `true` here — boot already probed it, and the health
        // tick below keeps it current so a backend that dies flips the farm
        // unhealthy and clients fail over (same contract as llama-server).
        // vLLM: true while it starts too — a PLANNED start keeps the farm healthy (busy says "Starting vLLM").
        // A vLLM the boot could neither use nor stop is 'stopped' (vllmStuckText): unhealthy from the start.
        engineUp: { external: true, vllm: vllmState.phase !== 'stopped', llamacpp: !!llamacppChild }[engineOf(config)] ?? null,
        // Why the configured engine is not the one serving (panel shows it).
        engineFallbackReason: externalBootError || vllmBootError || null,
    };
    liveReady = true;
    if (liveHealth.host) log.ok(`Hardware: ${log.paint.bold(liveHealth.host.gpu)} · ${liveHealth.host.vramGb}GB VRAM · ${liveHealth.host.ramGb}GB RAM · ${liveHealth.host.cpuCores} cores`);

    // 5a. The seat gate — the public listener in front of LiteLLM (see the
    // seatGateOn block above and src/seats.js). Started BEFORE the beacon so
    // the endpoint the farm advertises is never a dead port. Capacity, the idle
    // timeout and the password are thunks: a panel change applies to the gate live.
    let seats = null;
    let seatGateServer = null;
    // What people met at the gate (counts only, this run only) — the panel's Clients card.
    const gateStats = seatGateOn ? createGateStats() : null;
    if (seatGateOn) {
        seats = createSeats({
            capacity: () => backendInfo(config, liveHealth).slots,
            idleReleaseSec: () => config.proxy.seatIdleSec || 900,
        });
        try {
            seatGateServer = await startSeatGate({
                host: config.proxy.host,
                port: config.proxy.port,
                upstreamPort: internalPort,
                seats,
                idleReleaseSec: () => config.proxy.seatIdleSec || 900,
                password: () => config.proxy.masterKey || null,
                // §3.10: while the farm's vLLM is not ready, a generation gets a 503 that says why.
                unavailable: () => {
                    if (engineOf(config) !== 'vllm' || vllmState.phase === 'ready') return null;
                    return vllmState.phase === 'starting' || vllmState.phase === 'stopping'
                        ? 'This farm\'s model is starting: about 2 minutes. Try again then.'
                        : 'This farm\'s model is stopped for now. Try again later.';
                },
                stats: gateStats,
            });
        } catch (e) {
            log.err(`Seat gate could not bind ${config.proxy.host}:${config.proxy.port} (${e.code || e.message}). Is another farm running?`);
            await killTree(child.pid);
            await stopServices();
            return 1;
        }
        liveHealth.getSeats = () => seats.view();
        log.ok(`Seat gate on — ${log.paint.bold(String(backendInfo(config, liveHealth).slots))} seat(s), idle release after ${Math.round((config.proxy.seatIdleSec || 900) / 60)} min (proxy.seatIdleSec)`);
    }
    // The in-flight admin job rides the snapshot as `busy` so clients can explain a
    // bouncing proxy ("switching models…") instead of showing a raw error. jobBox is
    // indirection: the job system is defined further down, but the beacon can tick
    // before that code runs — a thunk that answers null until wired is TDZ-safe.
    // buildSnapshot keeps only an active job's kind, label, message and percent.
    const jobBox = { view: null };
    liveHealth.getJob = () => (jobBox.view ? jobBox.view() : null);
    // `callerIp` only from unicast /lol/self (it adds capacity.mine); the beacon calls it bare.
    const getSnapshot = (callerIp) => buildSnapshot(config, liveHealth, callerIp);
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
    kickBox.fn = () => { if (beacon) beacon.kick(); };
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
        vllmCheck: async () => ({ ok: false, error: 'farm still starting' }),
        vllmStart: async () => ({ ok: false, error: 'farm still starting' }),
        vllmStop: async () => ({ ok: false, error: 'farm still starting' }),
        vllmDownload: async () => ({ ok: false, error: 'farm still starting' }),
        vllmInstall: async () => ({ ok: false, error: 'farm still starting' }),
        vllmLibraryAdd: async () => ({ ok: false, error: 'farm still starting' }),
        vllmLibraryRemove: async () => ({ ok: false, error: 'farm still starting' }),
        vllmLog: async () => ({ ok: false, error: 'farm still starting' }),
        cancel: async () => ({ ok: false, error: 'farm still starting' }),
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
    // Plugin keys are tied to the farm password: with one set, a client fetches them here with it.
    const getPluginKeys = () => ({
        password: config.proxy.masterKey || null,
        keys: { extract: liveHealth.extractKey || null, classify: liveHealth.classifyKey || null, stt: liveHealth.sttKey || null, embed: liveHealth.embedKey || null },
    });
    const selfServer = startSelfServer({ httpPort: config.beacon.httpPort, getSnapshot, host: config.proxy.host, control, adminToken, onClientPing, getPluginKeys });
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
        if (svc.id === 'classify') liveHealth.classifyKey = svc.up ? svc.ctx.key : null;
        if (svc.id === 'stt') liveHealth.sttKey = svc.up ? svc.ctx.key : null;
        if (svc.id === 'embed') liveHealth.embedKey = svc.up ? svc.ctx.key : null;
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

    // Classify and speech to text start AFTER the farm is public: a first start installs ~1 GB (torch,
    // Laya's weights, the Whisper model), which used to keep every client waiting at a shut port. They
    // are the Computer's, read at run time, so nothing restarts Open WebUI when they appear. The message
    // bus starts quickly but is the Computer's too, so it comes up with them.
    // `lol down` from another shell must find them: step 6 hands over the runtime writer when it runs.
    let recordRuntime = () => {};
    void (async () => {
        for (const svc of services) {
            if (!svc.isLate(config) || !svc.enabled(config)) continue;
            try { await bringUp(svc); } catch (e) { log.warn(`${svc.label} did not start: ${e.message}`); }
            recordRuntime();
            if (beacon) beacon.kick();
        }
    })();

    // Keep the advertised health honest: re-probe proxy + hosts periodically and
    // push a fresh beacon. Cheap (a few HTTP HEADs) and unref'd.
    const hosts = config.ollama.hosts.map(ollama.normalizeHost);

    // Measured performance (llama.cpp, or an external vLLM) — see makePerfSampler.
    const perfSampler = makePerfSampler(config, liveHealth, () => !!llamacppChild, vllmReady);
    // A GPU latched at a low clock (a DGX Spark after a unified-memory OOM) — the panel says so.
    const clockWatch = perfMod.makeClockWatch();

    let healthInFlight = false; // skip a tick if the previous probe round is still running
    const healthTimer = setInterval(async () => {
        if (healthInFlight) return;
        healthInFlight = true;
        try {
            // A probe that meets a PLANNED restart (a switch, an Apply, a model start) is not a dead proxy: recording
            // it made the farm say unhealthy for up to a tick after every bounce, and clients left for another farm
            // (D5; found by the vLLM lifecycle test). restartProxy says up itself once the new LiteLLM answers.
            const bouncing = restartingProxy;
            const answered = await proxyApi.proxyLive(baseUrl);
            if (!bouncing && !restartingProxy) liveHealth.proxyUp = answered;
            const ups = await Promise.all(hosts.map((h) => ollama.version(h)));
            liveHealth.hostsUp = ups.filter(Boolean).length;
            const loadedLists = await Promise.all(hosts.map((h) => ollama.loadedModels(h)));
            liveHealth.loaded = [...new Set(loadedLists.flat())];
            liveHealth.gpu = await gpuLiveStats();
            liveHealth.gpu.stuckMhz = clockWatch(liveHealth.gpu);
            // The external backend is not our child — there is no exit event to
            // catch, so polling is the only way to know it died. Flipping engineUp
            // makes snapshot.healthy false and clients fail over to another farm.
            if (config.external.enabled) {
                const alive = await externalAlive(config.external);
                if (alive !== liveHealth.engineUp) {
                    log[alive ? 'ok' : 'err'](alive
                        ? `External engine at ${config.external.baseUrl} is back.`
                        : `External engine at ${config.external.baseUrl} stopped answering — this farm is now unhealthy so clients fail over.`);
                    liveHealth.engineUp = alive;
                    if (beacon) beacon.kick();
                }
            }
            // Only advertise a plugin while it's actually answering (and it came up) — so a
            // crashed/hung instance stops being advertised to clients. Guard on `wasUp`, NOT
            // `pid`: a child that died between boot and now has a null pid but must still be
            // re-probed to flip its stale advertisement off (probe() handles the null child).
            for (const svc of services) { if (svc.wasUp) liveHealth[svc.healthKey] = await svc.probe(config); }
            liveHealth.plugins = pluginsSummary(services, config);
            // The bus checks the farm password itself: hand it the current one (unchanged = nothing happens;
            // changed = every session made with the old one ends).
            sendBusKey(svcById.bus.child, config.proxy.masterKey);
            liveHealth.clientsConnected = freshClients().length; // decay the count when pings stop
            liveHealth.perf = await perfSampler.sample();
            // While another engine (llama.cpp, or an external server on this box)
            // serves, an Ollama model left in VRAM (OCR with keep-alive) starves it —
            // the live incident was a 12 GB card paging with both resident. Evict only
            // when the GPU is idle and nearly full, so a running extraction or
            // generation is never yanked mid-flight.
            if (perfMod.shouldEvictOllama({
                otherEngineOn: !ollamaServes(config),
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
    // Never written back once `lol down` (another shell, the Farm app's Quit) removed it: that removal is how this
    // farm learns it was asked to stop (onProxyExit, onVllmDown, restartProxy). A proxy bounce in the middle of a
    // `lol down` used to write it again, and the farm then lived on and restarted the vLLM `lol down` stopped.
    let runtimeWritten = false;
    const writeRuntimeState = () => {
        if (runtimeWritten && !readRuntime()) return;
        runtimeWritten = true;
        writeRuntimeFile();
    };
    const writeRuntimeFile = () => writeRuntime({
        litellmPid: child.pid,
        searxngPid: svcById.websearch.pid,
        kokoroPid: svcById.tts.pid,
        extractPid: svcById.ocr.pid,
        classifyPid: svcById.classify.pid,
        sttPid: svcById.stt.pid,
        busPid: svcById.bus.pid,
        embedPid: svcById.embed.pid,
        ollamaPids: oll.spawnedPids,
        llamacppPid: llamacppChild ? llamacppChild.pid : null,
        // Not a pid: vLLM outlives a crashed farm on purpose (D4). Where it lives, so `lol down` stops it.
        vllm: vllmRuntime(),
        proxyPort: config.proxy.port,
        endpoint: snapshot.endpoint,
        openaiBaseUrl: snapshot.openaiBaseUrl,
        configPath,
        farmId: snapshot.id,
        startedAt,
        host: os.hostname(),
    });
    writeRuntimeState();
    recordRuntime = writeRuntimeState;   // a late plugin (Classify, speech to text, the bus) records itself when up

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
        try { if (seatGateServer) seatGateServer.close(); } catch { /* already closed */ }
        await killTree(child.pid);
        for (const svc of services) { if (svc.pid) await killTree(svc.pid); }
        if (llamacppChild && llamacppChild.pid) await killTree(llamacppChild.pid);
        for (const pid of oll.spawnedPids) await killTree(pid);
        // vLLM is stopped on purpose here (Ctrl-C, SIGTERM): only a crash leaves it for the next farm to adopt.
        if (vllmTarget && (engineOf(config) === 'vllm' || jobs.downloading())) {
            if (engineOf(config) === 'vllm') {
                log.step('Stopping vLLM (this frees its GPU memory) …');
                const r = await stopVllmProcess();
                if (!r.ok) log.err(r.error);
            }
            if (jobs.downloading()) await vllmMod.stopInstall(vllmTarget);
        }
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
        try { if (seatGateServer) seatGateServer.close(); } catch { /* already closed */ }
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
            const nc = spawnLitellm(config, yamlPath, litellmBind);
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
                // `lol down` from another shell during the restart: it cleared the runtime file and killed this
                // LiteLLM, and onProxyExit stayed quiet (a restart). Stop as it asked, instead of living on with no
                // proxy and holding the farm's ports (found by the vLLM lifecycle test).
                if (!readRuntime()) { restartingProxy = false; shutdown('lol down'); }
                return false;
            }
            // `lol down` ran during the bounce and killed the LiteLLM it had read (the old one): the new one is not
            // recorded anywhere (writeRuntimeState does not write the file back), so stop as it asked.
            if (!readRuntime()) { restartingProxy = false; shutdown('lol down'); return false; }
            if (liveReady) liveHealth.proxyUp = true;   // it answers now: no stale "down" from a probe before the bounce
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

    // Standby catalog edit: while llama.cpp or an external server serves, nothing in
    // config.models is routed (litellm.js), so a change there needs no proxy restart —
    // bouncing LiteLLM would only drop everyone's in-flight chats for nothing — and
    // nothing may be warmed into the GPU the serving engine is using. Persist and say
    // when it applies.
    function standbyModels(next) {
        config.models = next;
        const warn = persistModels();
        if (beacon) beacon.kick();
        return warn;
    }
    const standbyNote = () => ` It is offered to clients when Ollama is the engine (${backendInfo(config, liveHealth).engine} is serving now).`;

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
        if (!ollamaServes(config)) {
            const warn = standbyModels(config.models.concat([entry]));
            return { ok: true, standby: true, message: `${id} added to the catalog.${standbyNote()}${warn || ''}`, servedModels: servedIdList(), warning: warn || null };
        }
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
        if (!ollamaServes(config)) {
            // Standby: not routed, so no proxy bounce. Evicting is still right —
            // it only frees VRAM for the engine that IS serving.
            const warn = standbyModels(next);
            for (const h of oll.reachable.filter(isLocalHost)) ollama.evictModel(h, removed.id).catch(() => {});
            return { ok: true, standby: true, servedModels: servedIdList(), warning: warn || null };
        }
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
            ps: await ollama.psModels(h),   // loaded, with the GPU memory each holds
        })));
        const installed = new Map();
        for (const ph of perHost) for (const m of ph.installed) if (!installed.has(m.name)) installed.set(m.name, m);
        const loaded = [...new Set(perHost.flatMap((ph) => ph.ps.map((m) => m.name)))];
        // Document reading beside vLLM (§1.4, §7.6): does its model fit the memory kept for it?
        const ocrModel = config.ocr.enabled ? resolveOcrModel(config, ocrInstalled) : null;
        const ocrSize = ocrModel && engineOf(config) === 'vllm' ? vllmMod.ocrFit({
            sizeBytes: ([...installed.values()].find((m) => norm(m.name) === norm(ocrModel)) || {}).size,
            vramBytes: (perHost.flatMap((ph) => ph.ps).find((m) => norm(m.name) === norm(ocrModel)) || {}).sizeVram,
            reserveGib: config.vllm.ocrReserveGib,
        }) : null;
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
                // `downloaded`: the panel's list says it, so an operator can prepare a switch from Ollama or vLLM.
                library: (config.llamacpp.library || []).map((e) => ({ ...e, downloaded: llamacpp.onDisk(e.url) })),
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
                // The default model's own context max (lazily probed) — the panel's
                // dropdown adapts its options to it. null until the probe answers.
                nativeMax: ollamaNativeMax(),
            },
            // Slots is advisory in the snapshot; SEATS are the enforced side (the
            // gate in front of LiteLLM — null when proxy.seatGate is off).
            capacity: {
                slots: backendInfo(config, liveHealth).slots,
                clients: freshClients().length,
                seats: seats ? seats.view() : null,
                seatIdleSec: seats ? (config.proxy.seatIdleSec || 900) : null,
                // Let in, turned away, wrong password, stopped, the fullest moment and the
                // wait for the first word: last hour + since start, counts only (seats.js).
                metrics: gateStats ? gateStats.view() : null,
                // false = the slot count (and therefore the seat count) is what the
                // config asked for, not what the engine does — an Ollama daemon we
                // did not start ignores our env. The panel explains + shows the fix.
                slotsVerified: backendInfo(config, liveHealth).slotsVerified !== false,
                unmanagedHosts: liveHealth.ollamaUnmanagedHosts || [],
                ollamaEnvAdvice: (liveHealth.ollamaUnmanagedHosts || []).length ? [
                    `OLLAMA_NUM_PARALLEL=${config.ollama.numParallel}`,
                    `OLLAMA_MAX_LOADED_MODELS=${config.ollama.maxLoadedModels}`,
                    `OLLAMA_FLASH_ATTENTION=${config.ollama.flashAttention ? 1 : 0}`,
                    ...(config.ollama.flashAttention && config.ollama.kvCacheType && config.ollama.kvCacheType !== 'f16'
                        ? [`OLLAMA_KV_CACHE_TYPE=${config.ollama.kvCacheType}`] : []),
                ].join(' ') : null,
            },
            // The VRAM budget for the current shape — the panel flags context
            // options that cannot fit instead of offering 256k on a 12 GB card.
            fit: config.llamacpp.enabled ? computeFit() : null,
            // Measured throughput + a short history for the panel's sparkline.
            perf: liveHealth.perf,
            perfHistory: perfSampler.history,
            // The declared seats x window vs a vLLM's real KV pool (null when they fit,
            // or when the server does not say) — the Performance card's warning.
            poolWarning: ['external', 'vllm'].includes(engineOf(config)) && liveHealth.perf
                ? perfMod.poolShortfall(backendInfo(config, liveHealth).slots, backendInfo(config, liveHealth).contextLength, liveHealth.perf.kvPoolTokens, engineOf(config))
                : null,
            // Which Ollama model document reading drives (shown as a badge, and why
            // Delete refuses it) — null when OCR is off.
            ocrModel,
            ocrFits: ocrSize ? ocrSize.fits : null, ocrGb: ocrSize ? ocrSize.gb : null,
            // The vLLM the farm runs (§3.5): its phase and what the last check found. The check itself runs only
            // on request (vllm/check), never per poll.
            vllm: vllmAdminState(),
            externalConfigured: externalConfigured(),
            download: downloadView(),
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
        if (!ollamaServes(config)) {
            // Standby: no routing change, no warm-up, and no context probe (that is
            // 2–4 full model loads) next to the engine that is serving.
            const warn = standbyModels(next);
            return { ok: true, standby: true, message: `${target.id} is the Ollama default.${standbyNote()}${warn || ''}`, defaultModel: target.id, servedModels: servedIdList(), warning: warn || null };
        }
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
        // A PINNED window belongs to the model it was pinned FOR. Live case
        // (2026-09-02, found by testing, on BOTH boxes): 1048576 pinned while a
        // 1M-native model was the default, then the default switched to a
        // 262144-native model — every request kept riding the stale 1M num_ctx,
        // 4× past what the new model was trained on, silently degrading answers.
        // On a switch, clamp a pin that exceeds the NEW default's native max, and
        // say so; a pin below native is a legitimate choice and is kept.
        if (ollamaServes(config) && typeof config.ollama.contextLength === 'number' && !busy()) {
            const pinned = config.ollama.contextLength;
            return runJob('context', `Checking ${target.id}'s context limit`, async (progress) => {
                const h2 = (oll.reachable || []).filter(isLocalHost)[0] || (oll.reachable || [])[0] || null;
                const meta = h2 ? await ollama.showModel(h2, target.id).catch(() => null) : null;
                const native = (meta && meta.contextLength) || null;
                ollamaNative.id = target.id; ollamaNative.max = native;   // keep the panel's dropdown honest immediately
                if (!(native && pinned > native)) {
                    return { ok: true, message: `${target.id} is the default.`, defaultModel: target.id, servedModels: servedIdList(), warning: warn || null };
                }
                config.ollama.contextLength = native;
                config.ollama.contextResolved = native;
                persist('ollama', { contextLength: native });
                progress('reloading routing', null);
                if (!(await restartProxy())) {
                    return { ok: false, error: 'The proxy did not come back after adjusting the context — restart the farm.', defaultModel: target.id };
                }
                if (beacon) beacon.kick();
                return {
                    ok: true,
                    message: `${target.id} is the default — context lowered ${pinned} → ${native}: the old pin belonged to the previous model and exceeds what this one was trained on.`,
                    defaultModel: target.id, servedModels: servedIdList(), warning: warn || null,
                };
            });
        }
        // A new default under AUTO context must be RE-PROBED now, not at the next
        // boot: the cached verdict is keyed per model, so until then every request
        // rides the PREVIOUS model's num_ctx — a quarter window for a long-context
        // model (live case: nemotron 1M behind gemma's 262144), or a spill for a
        // heavier one. The probe warms the new model as a side effect.
        if (ollamaServes(config) && config.ollama.contextLength === 'auto' && !busy()) {
            return runJob('context', `Sizing the context window for ${target.id}`, async (progress) => {
                config.ollama.contextResolved = null;
                await resolveOllamaContext(progress);
                if (!(await restartProxy())) {
                    return { ok: false, error: 'The proxy did not come back after re-sizing the context — restart the farm.', defaultModel: target.id };
                }
                if (beacon) beacon.kick();
                return {
                    ok: true,
                    message: `${target.id} is the default — context sized to ${config.ollama.contextResolved} tokens on this box.`,
                    defaultModel: target.id, servedModels: servedIdList(), warning: warn || null,
                };
            });
        }
        return { ok: true, defaultModel: target.id, servedModels: servedIdList(), warning: warn || null };
    }

    // Change the context window — how much of a conversation or document the model reads
    // at once. This USED to write only ollama.contextLength, which meant that on a farm
    // running the llama.cpp backend (the default) the control did nothing at all to the
    // model everyone was actually chatting with. It now applies to whichever engine is
    // serving, and persists.
    //
    // The two engines take it differently, and the difference is visible to users:
    //   • llama.cpp — --ctx-size is argv, so this reloads the model. With kvUnified
    //     (the default) the `parallel` slots share ONE pool: a person alone gets the
    //     whole window, contextLength / slots is the floor under full contention;
    //     kvUnified:false restores the hard split (each user gets contextLength / slots).
    //   • Ollama — num_ctx rides the generated routing, so a proxy bounce is enough and
    //     every request keeps the full window.
    function setContextLength(tokens) {
        // An external server's window is whatever it was launched with; the farm only
        // DECLARES it (external.contextLength). Changing Ollama's here would do nothing
        // for chat and, under 'auto', load models into the GPU vLLM is using.
        if (config.external.enabled) return externalRefusal();
        if (engineOf(config) === 'vllm') return applyFarmSettings({ context: tokens });
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
        // Upper bound = the serving model's own native max when known (what the
        // dropdown offers); else a generous typo-catcher. The old hard 262144
        // refused every long-context model — live case: a 1M-native model whose
        // panel could never apply what the model supports.
        const nativeCap = config.llamacpp.enabled
            ? (((computeFit() || {}).nativeMax) || null)
            : ollamaNativeMax();
        const hardCap = nativeCap || 4194304;
        if (!Number.isFinite(want) || want < 2048 || want > hardCap) {
            return {
                ok: false,
                error: `Context must be between 2048 and ${hardCap} tokens${nativeCap ? " (this model's maximum)" : ''}.`,
                contextLength: config.ollama.contextLength,
            };
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
                ? ` ⚠ ${want} tokens needs ~${fitAt.needGb} GB — this GPU has ${fitAt.vramGb} GB free for it, so part of the model now lives in system RAM. Expect a few tokens/second${fitAt.maxContext >= 4096 ? `; ${fitAt.maxContext} is the largest that fits` : ''}.`
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
                const par = config.llamacpp.parallel;
                const each = par > 1
                    ? (config.llamacpp.kvUnified !== false
                        ? `, one pool shared by ${par} slots (${perSlot} guaranteed each)`
                        : ` (${perSlot} per slot across ${par} slots)`)
                    : '';
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
        return notSaved(r);
    }
    function persistLlamacpp(patch) {
        Object.assign(config.llamacpp, patch);
        return persist('llamacpp', patch);
    }
    // config.models is what `lol up`'s picker rewrites at boot, so persisting it makes
    // panel changes survive a restart the same way an edited file would.
    function persistModels() {
        const r = patchConfigFile(configPath, (raw) => { raw.models = config.models; return raw; });
        return notSaved(r);
    }

    // --- long jobs ---------------------------------------------------------------
    // Fetching a model is minutes of work; an admin HTTP request is seconds. So every
    // route that downloads weights STARTS a job and returns at once, and the panel —
    // already polling /lol/admin/state every 5 s — renders the progress. The job slot
    // and the download slot are makeJobs' (module level, tested on their own).
    const { runJob, runDownload, busy, busyErr, jobView, downloadView } = jobs;
    jobBox.view = jobView;   // from here on, the snapshot can report `busy`

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

    // Switch which engine answers the model clients auto-select (§5.5): Ollama (the catalog, a few people), llama.cpp
    // (one model, fastest on a small card), vLLM (one model, many people on a big NVIDIA GPU), or an external server
    // (only while the file names one: a developer set it up). One engine at a time: the current one stops FIRST, and
    // a stop that fails changes nothing (two engines on one GPU is the failure this prevents). The flags are written
    // so exactly one is true; the name moves with the switch (carryNameAcross). A target that does not come up puts
    // the flags, the names and the previous engine back.
    const ENGINE_NAMES = { ollama: 'Ollama', llamacpp: 'llama.cpp', vllm: 'vLLM', external: 'the external server' };
    // The External button: while the file holds an external server a developer wrote, except one on the port of the
    // vLLM this farm runs (switching to it would stop that vLLM and find nothing there).
    function externalConfigured() {
        const raw = readRawConfig(configPath);
        if (!(raw && raw.external && typeof raw.external === 'object')) return false;
        return !(engineOf(config) === 'vllm' && loopbackPort(config.external.baseUrl) === config.vllm.port);
    }
    // Why vLLM cannot be switched to or started now (checked up front, before anything stops), or null.
    async function vllmRefusal() {
        if (!vllmSup.ok) return vllmMod.UNSUPPORTED;
        const d = jobs.downloading();
        if (d && d.kind === 'install') return 'vLLM is being installed: wait for it, or stop it.';
        if (!vllmProbe || !vllmProbe.st) await checkVllm();
        const pr = vllmMod.problemsFrom({ ...vllmProbe, installKind: d ? d.kind : null }, config);
        if (pr.problems.length) return pr.problems[0];
        // An explicit memory for conversations can be checked against one person's window now; Automatic is
        // worked out at the start, once the current engine has left the GPU.
        if (config.vllm.kvCacheGib !== 'auto') {
            const plan = vllmMod.planFor(config, vllmProbe.st, vllmMod.memOf(vllmProbe.st), { embedReserveGib: embedReserveGib() });
            if (!plan.ok) return plan.reason;
        }
        return null;
    }
    function snapshotEngineState() {
        const defEntry = defaultModelEntry(config);
        const mem = {
            flags: Object.fromEntries(['external', 'vllm', 'llamacpp'].map((s) => [s, !!config[s].enabled])),
            alias: Object.fromEntries(['external', 'vllm', 'llamacpp'].map((s) => [s, config[s].alias])),
            modelAlias: config.modelAlias ?? null,
            defAlias: defEntry ? defEntry.alias : undefined,
        };
        // The FILE goes back to exactly what it held, so a fallback's in-memory names are never written by a rollback.
        const raw = readRawConfig(configPath);
        const disk = raw && JSON.parse(JSON.stringify({
            sections: Object.fromEntries(['external', 'vllm', 'llamacpp'].map((s) => [s, s in raw ? { v: raw[s] } : null])),
            modelAlias: 'modelAlias' in raw ? { v: raw.modelAlias } : null,
            models: 'models' in raw ? { v: raw.models } : null,
        }));
        return () => {
            for (const s of ['external', 'vllm', 'llamacpp']) { config[s].enabled = mem.flags[s]; config[s].alias = mem.alias[s]; }
            config.modelAlias = mem.modelAlias;
            if (defEntry) { if (mem.defAlias) defEntry.alias = mem.defAlias; else delete defEntry.alias; }
            if (!disk) return;
            patchConfigFile(configPath, (r) => {
                for (const [s, v] of Object.entries(disk.sections)) { if (v) r[s] = v.v; else delete r[s]; }
                if (disk.modelAlias) r.modelAlias = disk.modelAlias.v; else delete r.modelAlias;
                if (disk.models) r.models = disk.models.v; else delete r.models;
                return r;
            });
        };
    }
    function setEngineFlags(want) {
        for (const s of ['external', 'vllm', 'llamacpp']) config[s].enabled = s === want;
        const r = patchConfigFile(configPath, (raw) => {
            raw.llamacpp = { ...(raw.llamacpp || {}), enabled: want === 'llamacpp' };
            if (raw.vllm || want === 'vllm') raw.vllm = { ...(raw.vllm || {}), enabled: want === 'vllm' };
            if (raw.external) raw.external = { ...raw.external, enabled: want === 'external' };
            return raw;
        });
        return notSaved(r);
    }
    async function stopEngine(e, progress) {
        if (e === 'llamacpp') { progress('stopping llama.cpp', null); await stopLlamacpp(); return { ok: true }; }
        if (e === 'ollama') { await evictOllama(progress); return { ok: true }; }
        if (e === 'vllm') {
            progress('stopping vLLM', null);
            const was = vllmState.phase;
            setVllmPhase('stopping');
            const r = await stopVllmProcess();
            setVllmPhase(r.ok ? 'stopped' : was);
            return r;
        }
        return { ok: true };   // an external server is not ours to stop
    }
    async function startEngine(e, progress) {
        if (e === 'vllm') return startVllm(progress);
        if (e === 'llamacpp') return startLlamacpp(progress);
        if (e === 'external') {
            return (await externalAlive(config.external)) ? { ok: true }
                : { ok: false, message: `The external server at ${config.external.baseUrl} does not answer.` };
        }
        progress('sizing the context window', null);
        await resolveOllamaContext(progress);
        return { ok: true };
    }
    async function setBackend(engine) {
        const want = String(engine || '').toLowerCase().replace('llama.cpp', 'llamacpp');
        if (!['ollama', 'llamacpp', 'vllm', ...(externalConfigured() ? ['external'] : [])].includes(want)) {
            return { ok: false, error: 'Pick Ollama, llama.cpp or vLLM.' };
        }
        const from = engineOf(config);
        if (from === want) return { ok: true, already: true, engine: want };
        if (busy()) return busyErr();
        // The external server is a vLLM on this computer the farm can run as it is (§9): switching to vLLM then means
        // keeping it, with nothing restarted, not stopping it to start the same thing again.
        if (want === 'vllm' && from === 'external' && takeOverOffer) return serialize(() => vllmTakeOverRun());
        if (want === 'llamacpp' && !(llamacpp.installed(config.llamacpp.binDir) || llamacpp.supported())) {
            return { ok: false, error: 'Not available on this computer: there is no ready-made llama.cpp for it.' };
        }
        if (want === 'vllm') { const why = await vllmRefusal(); if (why) return { ok: false, error: why }; }
        if (busy()) return busyErr();   // the check above can take a while
        return runJob('backend', `Switching to ${ENGINE_NAMES[want]}`, async (progress) => {
            const restore = snapshotEngineState();
            const stopped = await stopEngine(from, progress);
            if (!stopped.ok) return { ok: false, error: `${stopped.error} Nothing changed: ${ENGINE_NAMES[from]} keeps serving.` };
            const warn = setEngineFlags(want);
            const plan = carryNameAcross(config, from, want);
            applyNamePlan(config, plan);
            persistNamePlan(plan);
            if (want === 'vllm') setVllmPhase('starting', 'starting vLLM');
            let r = await startEngine(want, progress);
            if (r.ok) {
                progress('reloading routing', null);
                if (!(await restartProxy())) r = { ok: false, message: 'The proxy did not come back.' };
            }
            if (r.ok) {
                if (want !== 'vllm') setVllmPhase(null);
                setEngineUp(want === 'ollama' ? null : true);
                if (liveReady) liveHealth.engineFallbackReason = null;
                vllmBootError = null;   // the panel's "vLLM could not start" belongs to the engine that served before
                await refreshOcrModel();
                writeRuntimeState();
                return { ok: true, message: `${ENGINE_NAMES[want]} is now serving.${warn || ''}` };
            }
            // Undo: nothing half-started keeps the GPU, then the flags, the names and the previous engine come back.
            progress('undoing the switch', null);
            if (want !== from) await stopEngine(want, () => {});
            restore();
            const back = await startEngine(from, () => {});
            if (from !== 'vllm') setVllmPhase(null);
            await restartProxy();
            await refreshOcrModel();
            writeRuntimeState();
            kickBox.fn();
            return { ok: false, error: `${r.message} The switch was undone${back.ok ? '' : `, but ${ENGINE_NAMES[from]} did not come back either: ${back.message}`}.` };
        });
    }

    // ---- vLLM's own controls (the panel's vLLM card, §7.2) ----------------------------------------------------
    // What an install or a download leaves free on the disk it fills (on Windows, WSL's disk grows on drive C: and
    // never shrinks: a full C: stops Windows itself).
    const DISK_KEEP_GB = 10;
    function hostFitOf() {
        const f = hostGpu.name && hostGpu.gb ? vllmMod.gpuFit(config, hostGpu.gb) : null;
        return f && { gb: hostGpu.gb, fits: f.fits, needGb: Math.ceil(f.needGib) };
    }
    function vllmAdminState() {
        const v = config.vllm; const e = vllmMod.vllmEntry(config);
        const st = vllmProbe && vllmProbe.st;
        const dl = jobs.downloading();
        // The farm's own install or download is on the download bar, so the checklist does not list it as one "started
        // earlier"; a switch or a start still refuses during an install (vllmRefusal, startVllm).
        const pr = vllmProbe ? vllmMod.problemsFrom({ ...vllmProbe, installKind: dl ? 'download' : null }, config) : null;
        const inst = st && vllmTarget ? st.installs.find((i) => i.root === vllmTarget.root) : null;
        const onDisk = (x) => st && st.models.find((m) => m.folder === vllmMod.folderOf(x));
        const gb = (n) => Math.round(n * 10) / 10;
        // What the panel's rows and trade line work with (§7.1): the card, the model's memory per person and its
        // window, what Automatic memory gives (what vLLM runs with, else worked out from the last check; null when
        // vLLM runs with a set amount, which leaves no free memory to measure), and the Automatic people at once.
        const mem = st && st.gpu ? vllmMod.memOf(st) : null;
        const f = vllmMod.facts(e);
        const disk = e && onDisk(e);
        let autoKvGib = null;
        if (v.kvCacheGib === 'auto' && vllmState.phase === 'ready') autoKvGib = v.kvResolvedGib ?? null;
        else if (mem && e && !st.running) {
            const p = vllmMod.planFor({ ...config, vllm: { ...v, kvCacheGib: 'auto' } }, st, mem, { embedReserveGib: embedReserveGib() });
            autoKvGib = p.ok ? p.kvGib : null;
        }
        const pool = vllmState.phase === 'ready' && v.kvResolvedGib != null ? v.kvResolvedGib : (v.kvCacheGib === 'auto' ? autoKvGib : v.kvCacheGib);
        const auto = e ? vllmMod.seatsAuto(e, st && st.gpu ? st.gpu.name : null, v.contextLength, vllmMod.peopleFit(pool, v.contextLength, f)) : null;
        return {
            enabled: !!v.enabled, supported: vllmSup.ok,
            probe: vllmProbe ? { at: vllmProbe.at, oks: pr.oks, problems: pr.problems, warnings: pr.warnings, gpuTooSmall: pr.gpuTooSmall } : null,
            // What nvidia-smi showed at boot, before any check: the vLLM button says at once that no model of the list
            // fits this GPU (an RTX 4070 or 4080), or that no NVIDIA GPU was found, instead of offering to set it up.
            hostFit: hostFitOf(),
            noNvidia: !hostGpu.name,
            installed: !!inst, version: inst ? inst.version : null, pinned: v.version,
            root: vllmTarget ? vllmTarget.root : v.root, distro: vllmTarget ? vllmTarget.distro : v.distro, port: v.port,
            hostDrive: vllmProbe ? vllmProbe.hostDrive : null,   // Windows: the drive that holds WSL's disk
            alias: v.alias, model: v.model,
            library: (v.library || []).map((x) => {
                const m = onDisk(x);
                return { ...x, downloaded: !!(m && !m.partial), partial: !!(m && m.partial), gbOnDisk: m ? gb(m.gb) : null, active: x.id === v.model, generic: vllmMod.isGeneric(x) };
            }),
            foundFolders: st ? st.models.filter((m) => !(v.library || []).some((x) => vllmMod.folderOf(x) === m.folder)).map((m) => ({ folder: m.folder, gb: gb(m.gb) })) : [],
            contextLength: v.contextLength, parallel: v.parallel, parallelResolved: v.parallelResolved ?? null,
            maxNumSeqs: v.maxNumSeqs, maxNumSeqsResolved: v.maxNumSeqsResolved ?? null,
            kvCacheGib: v.kvCacheGib, kvResolvedGib: v.kvResolvedGib ?? null,
            phase: vllmState.phase, phaseText: vllmState.text, percent: vllmState.percent, adopted: vllmState.adopted,
            bootError: vllmBootError, bootErrorRan: vllmBootErrorRan, poolTokens: vllmState.poolTokens, peopleFit: vllmState.peopleFit, guardLine: vllmState.guardLine,
            running: vllmState.phase === 'ready' || !!vllmChild,
            measured: e && st && st.gpu ? vllmMod.measuredFor(e, st.gpu.name) : null,
            launchSettings: vllmState.launchSettings,
            facts: { kvBytesPerToken: f.kvBytesPerToken, stateBytes: f.stateBytes, nativeCtx: f.nativeCtx || (disk && disk.native) || null },
            autoKvGib, seatsAuto: auto,
            cardGib: mem ? gb(mem.totalGib) : null, unified: mem ? !!mem.unified : null,
            ocrReserveGib: config.ocr.enabled ? v.ocrReserveGib : 0,
            embedReserveGib: embedReserveGib(),
            minFreeGb: v.minFreeGb === 'auto' ? (mem && mem.unified ? 8 : null) : (v.minFreeGb || null),
            // Install is offered once the check sees a GPU this vLLM can use, big enough for a model of the list, and
            // the tools a start needs; Update when another version is there.
            installable: !!(st && st.gpu && st.curl && st.cc && ['x86_64', 'aarch64'].includes(st.arch) && pr && !pr.gpuTooSmall),
            venvLink: !!(inst && inst.link),
            installing: !!(st && st.installing),
            // "Let the farm run vLLM" (§9): the offer, then what was done, with Undo while it is possible.
            takeOver: takeOverOffer ? { root: takeOverOffer.root, running: takeOverOffer.running, distro: takeOverOffer.distro, platform: process.platform } : null,
            takenOver: takeOverDone ? { root: takeOverDone.offer.root, platform: process.platform, undo: takeOverUndoable() } : null,
        };
    }
    // Check this computer again (the panel's Check again, and the first open of the vLLM card), and whether a vLLM
    // the farm routes to as an external server can be taken over.
    async function vllmCheck() {
        await checkVllm();
        await detectTakeOver();
        return { ok: true, vllm: vllmAdminState() };
    }

    // ---- "Let the farm run vLLM" (§9): a vLLM on this computer that the farm routes to as an external server ----
    // The farm offers it and a person clicks it (the owner's question (a)): looked for once the farm is public (it
    // can boot WSL's distribution, so it never holds the boot up) and on Check again.
    // The configured engine is an external server on this computer: its port, else null. Read from the file: a farm
    // whose external server did not answer at its start serves another engine in memory.
    function localExternalPort() {
        const raw = readRawConfig(configPath);
        if (!(raw && raw.external && raw.external.enabled === true)) return null;
        return loopbackPort(config.external.baseUrl);
    }
    async function detectTakeOver() {
        const port = vllmSup.ok && !takeOverDone ? localExternalPort() : null;
        if (!port) { takeOverOffer = null; return null; }
        const pr = await vllmMod.takeOverProbe(config, port, { hostGpu });
        const plan = vllmMod.takeOverPlan(config, pr.st, port, { answering: await externalAlive(config.external, 3000) });
        takeOverOffer = plan && { ...plan, probe: pr };
        if (plan) log.info(`A vLLM on this computer, from ${plan.root}: the panel offers to let the farm run it.`);
        // A check that could not run says why (it was silent on the PRO 6000, 2026-10-08: status.sh was missing).
        else if (!pr.st && pr.stError) log.warn(`Could not look for a vLLM the farm could run: ${pr.stError}`);
        return takeOverOffer;
    }
    // The routing LiteLLM runs with, its keys aside: a take-over that leaves it the same restarts nothing.
    const routingOf = () => JSON.stringify(buildLitellmConfig(config, peers), (k, v) => (k === 'api_key' ? undefined : v));
    const takeOverTail = () => (process.platform === 'win32'
        ? ' If this computer started vLLM at log on before, that now only opens the Farm app.'
        : ' If a service started it at boot before (lol-vllm), that service starts nothing now: to remove it, run  sudo systemctl disable lol-vllm .');
    // §9.3: the file first (a copy, then the vllm block in and the external block out), then serve.sh's marker (the
    // old launchers do nothing from now on), then in memory. A server that serves as the external engine now is kept
    // as it runs: same process, and LiteLLM is not restarted when its routing stays the same. Otherwise (it did not
    // answer when the farm started, or it is still starting) the farm switches to it as a boot does.
    async function vllmTakeOverRun() {
        if (takeOverDone) return { ok: true, already: true };
        const offer = await detectTakeOver();   // what runs now, not what ran when the panel was drawn
        if (!offer) return { ok: false, error: 'There is no vLLM on this computer that the farm can run as it is now. Press Check again.' };
        const before = { external: { ...config.external }, vllm: config.vllm, target: vllmTarget, probe: vllmProbe };
        const routeBefore = routingOf();
        const from = engineOf(config);
        const f = takeOverFile(configPath, offer.block);
        if (!f.ok) return { ok: false, error: `The farm could not save its settings (${f.error}), so nothing changed.` };
        const t = { platform: process.platform, distro: offer.distro, root: offer.root, port: offer.port };
        const m = await vllmMod.setMarker(t, true);
        if (!m.ok) { undoTakeOverFile(configPath); return { ok: false, error: `${m.error} Nothing changed.` }; }
        config.vllm = ConfigSchema.shape.vllm.parse(readRawConfig(configPath).vllm);
        config.external.enabled = false;
        const llamacppWasOn = config.llamacpp.enabled;
        config.llamacpp.enabled = false;   // one engine on, as the file now says (takeOverFile)
        vllmTarget = t; vllmProbe = offer.probe; vllmBootError = null; takeOverOffer = null;
        if (liveReady) liveHealth.engineFallbackReason = null;
        if (offer.running && offer.ready && from === 'external') {
            adoptVllm(offer.resolved);
            const same = routingOf() === routeBefore;
            if (same) writeLitellmConfig(config, yamlPath, peers);   // the file only: LiteLLM already routes this way
            else await restartProxy();
            setEngineUp(true);
            writeRuntimeState();
            takeOverDone = { offer, before, wrote: fsMod.readFileSync(configPath, 'utf8') };
            log.ok(`The farm runs the vLLM from ${offer.root} now: kept running${same ? ', nothing restarted' : ''}.`);
            return { ok: true, message: `The farm now runs vLLM. ${same ? 'Nothing was restarted.' : 'vLLM kept running.'}${takeOverTail()}` };
        }
        if (from === 'llamacpp' || llamacppWasOn) await stopLlamacpp();   // the stand-in engine leaves the GPU (Ollama's models: startVllm)
        setVllmPhase('starting', 'starting vLLM');
        if (routingOf() !== routeBefore) await restartProxy(); else writeLitellmConfig(config, yamlPath, peers);
        await refreshOcrModel();
        writeRuntimeState();
        takeOverDone = { offer, before: null, wrote: null };
        log.ok(`The farm runs the vLLM from ${offer.root} now, and starts it.`);
        return startVllmJob('Starting vLLM', { waitOnly: offer.running });
    }
    // Undo (§9.4), while vLLM still runs as it was taken over and nothing was saved since: the copy of the file back,
    // the marker away, the external server routed again; vLLM keeps running.
    function takeOverUndoable() {
        const d = takeOverDone;
        if (!d || !d.before || vllmState.phase !== 'ready' || !vllmState.adopted) return false;
        try { return fsMod.readFileSync(configPath, 'utf8') === d.wrote; } catch { return false; }
    }
    async function vllmUndoTakeOver() {
        if (!takeOverUndoable()) return { ok: false, error: 'Undo is possible only until a setting changes or the farm restarts.' };
        const d = takeOverDone; const t = vllmTarget;
        const m = await vllmMod.setMarker(t, false);
        if (!m.ok) return { ok: false, error: `${m.error} Nothing changed.` };
        const f = undoTakeOverFile(configPath);
        if (!f.ok) { await vllmMod.setMarker(t, true); return { ok: false, error: `The farm could not put its settings back (${f.error}), so nothing changed.` }; }
        const routeNow = routingOf();
        config.external = d.before.external; config.vllm = d.before.vllm; vllmTarget = d.before.target; vllmProbe = d.before.probe;
        vllmState.adopted = false; vllmState.launchSettings = null; setVllmPhase(null);
        if (routingOf() === routeNow) writeLitellmConfig(config, yamlPath, peers); else await restartProxy();
        writeRuntimeState();
        kickBox.fn();
        takeOverDone = null; takeOverOffer = d.offer;   // offered again
        log.ok(`Take-over undone: the farm routes to the vLLM from ${t.root} without running it.`);
        return { ok: true, message: 'Back as before: the farm routes to vLLM without running it.' };
    }
    function vllmStart() {
        if (engineOf(config) !== 'vllm') return { ok: false, error: 'vLLM is not this farm\'s engine: switch to it first.' };
        if (vllmState.phase === 'ready') return { ok: true, already: true };
        if (busy()) return busyErr();
        const d = jobs.downloading();
        if (d && d.kind === 'install') return { ok: false, error: 'vLLM is being installed: wait for it, or stop it.' };
        return startVllmJob('Starting vLLM');
    }
    // The operator's Stop: nobody can chat until Start or a switch, so the farm says it is unhealthy and clients
    // fail over. Not kept across a farm restart (the owner's question (b): the next start starts vLLM).
    function vllmStop() {
        if (engineOf(config) !== 'vllm') return { ok: false, error: 'vLLM is not this farm\'s engine.' };
        if (busy()) return busyErr();
        return runJob('engine', 'Stopping vLLM', async (progress) => {
            const r = await stopEngine('vllm', progress);
            if (!r.ok) return { ok: false, error: r.error };
            setEngineUp(false);
            writeRuntimeState();
            return { ok: true, message: 'vLLM is stopped, so nobody can chat. Press Start vLLM, or switch to another engine.' };
        });
    }
    // Download a model of the vLLM list, in the download slot (D7): it runs while vLLM serves another model, and
    // a stopped download keeps the files it finished.
    function vllmDownload(id) {
        const e = (config.vllm.library || []).find((x) => x.id === id);
        if (!e) return { ok: false, error: 'That model is not in the vLLM list.' };
        if (!e.repo) return { ok: false, error: `${e.label} is a folder on this computer: there is nothing to download.` };
        if (!vllmSup.ok) return { ok: false, error: vllmMod.UNSUPPORTED };
        let target = null;
        return runDownload('download', `Downloading ${e.label}`, async (progress, ctl) => {
            progress('checking this computer', null);
            await checkVllm();   // what is on disk now: the space, the part already downloaded
            target = vllmTarget;
            if (!target || !vllmProbe.st) return { ok: false, error: 'This computer did not answer the check. Press Check again.' };
            // The download uses the `hf` of vLLM's own environment.
            if (!vllmProbe.st.installs.some((i) => i.root === target.root)) return { ok: false, error: 'vLLM is not installed on this computer yet: press Install vLLM first.' };
            const disk = vllmMod.diskCheck(vllmProbe, e, { keepGb: DISK_KEEP_GB, button: 'Download', distro: target.distro });
            if (disk.problem) return { ok: false, error: disk.problem };
            writeRuntimeState();
            const r = await vllmMod.install(target, { steps: 'model', repo: e.repo, folder: vllmMod.folderOf(e), version: config.vllm.version, sizeGb: e.sizeGb },
                (p) => {
                    if (p.bytes != null) progress(vllmMod.installStepText('model', { label: e.label, bytes: p.bytes, total: p.total }), p.total ? (p.bytes / p.total) * 100 : null, { bytes: p.bytes, total: p.total });
                    else progress(vllmMod.installStepText(p.step, { label: e.label, version: config.vllm.version }), null);
                });
            await checkVllm().catch(() => null);
            if (ctl.cancelled()) return { ok: false, error: 'Stopped. Press Download again to go on: the files it finished are kept.' };
            if (!r.ok) return { ok: false, error: vllmMod.downloadFailure(r, e.repo) };
            return { ok: true, message: `${e.label} is downloaded.` };
        }, { cancel: () => (target ? vllmMod.stopInstall(target) : null), about: e.id, onSettled: writeRuntimeState });
    }
    // Install vLLM, or update it to the version this farm was tested with (§4.3), in the download slot: install.sh
    // makes its Python environment and installs vLLM (about 8 GB), then downloads the chosen model. The farm keeps
    // serving meanwhile, and a stopped install keeps what it finished. Refused while vLLM runs from that folder:
    // its files are in use.
    function vllmInstall() {
        if (!vllmSup.ok) return { ok: false, error: vllmMod.UNSUPPORTED };
        const runningHere = () => (engineOf(config) === 'vllm' && !['stopped', 'guard', 'failed', null].includes(vllmState.phase))
            || !!(vllmProbe && vllmProbe.st && vllmProbe.st.running);
        const update = !!(vllmProbe && vllmProbe.st && vllmTarget && vllmProbe.st.installs.some((i) => i.root === vllmTarget.root));
        const button = update ? 'Update vLLM' : 'Install vLLM';
        if (runningHere()) return { ok: false, error: `vLLM is running from this folder, so it cannot be ${update ? 'updated' : 'installed'} now: press Stop vLLM first.` };
        const e = vllmMod.vllmEntry(config);
        let target = null;
        return runDownload('install', update ? 'Updating vLLM' : 'Installing vLLM', async (progress, ctl) => {
            progress('checking this computer', null);
            await checkVllm();
            target = vllmTarget;
            if (!target || !vllmProbe.st) return { ok: false, error: 'This computer did not answer the check. Press Check again.' };
            if (runningHere()) return { ok: false, error: `vLLM is running from ${target.root}: press Stop vLLM first, then ${button} again.` };
            const disk = vllmMod.diskCheck(vllmProbe, e && e.repo ? e : null, { venv: true, keepGb: DISK_KEEP_GB, button, distro: target.distro });
            if (disk.problem) return { ok: false, error: disk.problem };
            writeRuntimeState();
            const label = e ? e.label : 'the model';
            const r = await vllmMod.install(target, {
                steps: e && e.repo ? 'venv,model' : 'venv', repo: e && e.repo, folder: e && vllmMod.folderOf(e), version: config.vllm.version, sizeGb: e && e.sizeGb,
            }, (p) => {
                if (p.bytes != null) progress(vllmMod.installStepText('model', { label, bytes: p.bytes, total: p.total }), p.total ? (p.bytes / p.total) * 100 : null, { bytes: p.bytes, total: p.total });
                else progress(vllmMod.installStepText(p.step, { label, version: config.vllm.version }), null);
            });
            await checkVllm().catch(() => null);
            if (ctl.cancelled()) return { ok: false, error: `Stopped. Press ${button} again to go on: what it finished is kept.` };
            if (!r.ok) {
                return { ok: false, error: r.kind ? vllmMod.downloadFailure(r, e && e.repo, button)
                    : `${update ? 'Updating' : 'Installing'} vLLM stopped: ${String(r.error || 'no answer').slice(0, 200)}. Press ${button} again to try once more.` };
            }
            if (!config.vllm.root) { config.vllm.root = target.root; persist('vllm', { root: target.root }); }   // remembered once used
            return { ok: true, message: `vLLM ${config.vllm.version} is installed${e && e.repo ? `, with ${e.label}` : ''}.` };
        }, { cancel: () => (target ? vllmMod.stopInstall(target) : null), onSettled: writeRuntimeState });
    }
    // Stop on the download bar: the farm's own download or install; else one started earlier that the check found
    // still running (the checklist's "Stop it").
    async function cancelDownload() {
        if (jobs.downloading()) return jobs.cancel('download');
        if (!(vllmTarget && vllmProbe && vllmProbe.st && vllmProbe.st.installing)) return { ok: false, error: 'Nothing is running there.' };
        await vllmMod.stopInstall(vllmTarget);
        await checkVllm().catch(() => null);
        return { ok: true, message: 'Stopped. Press Download again to go on: the files it finished are kept.' };
    }
    // Add a model to the vLLM list (§4.4): a Hugging Face name or link, or a folder already on this computer. It only
    // remembers it: Download, then Use this.
    function vllmLibraryAdd(body = {}) {
        const st = vllmProbe && vllmProbe.st;
        const r = vllmMod.newLibraryEntry(body, config.vllm.library || [], st ? st.models : []);
        if (r.error) return { ok: false, error: r.error };
        config.vllm.library = [...(config.vllm.library || []), r.entry];
        // A built-in model added back is no longer one the operator removed.
        config.vllm.removed = (config.vllm.removed || []).filter((id) => id !== r.entry.id);
        const warn = persist('vllm', { library: config.vllm.library, removed: config.vllm.removed });
        return { ok: true, id: r.entry.id, message: `${r.entry.label} is in the list.${r.entry.repo ? ' Press Download, then Use this.' : ''}${warn || ''}` };
    }
    // Remove one from the list, and with `deleteFiles` its folder too. Never the chosen model, the one running, or
    // one being downloaded.
    async function vllmLibraryRemove(body = {}) {
        const lib = config.vllm.library || [];
        const e = lib.find((x) => x.id === body.id);
        if (!e) return { ok: true, already: true };
        const runningModel = vllmState.launchSettings && vllmState.phase === 'ready' ? vllmState.launchSettings.modelId : null;
        if (e.id === config.vllm.model || e.id === runningModel) return { ok: false, error: `${e.label} is the model vLLM serves: pick another one with Use this first.` };
        const d = jobs.downloading();
        if (d && d.about === e.id) return { ok: false, error: `${e.label} is being downloaded: stop the download first.` };
        let deleted = '';
        if (body.deleteFiles) {
            if (!vllmTarget) await checkVllm();
            if (!vllmTarget) return { ok: false, error: 'This computer did not answer the check. Press Check again.' };
            const r = await vllmMod.removeFolder(vllmTarget, vllmMod.folderOf(e));
            if (!r.ok) return { ok: false, error: r.error };
            deleted = ' Its files are deleted.';
        }
        config.vllm.library = lib.filter((x) => x !== e);
        // A built-in model stays out at the next start, when the list is completed with the built-ins it lacks.
        if (VLLM_LIBRARY.some((x) => x.id === e.id) && !(config.vllm.removed || []).includes(e.id)) config.vllm.removed = [...(config.vllm.removed || []), e.id];
        const warn = persist('vllm', { library: config.vllm.library, removed: config.vllm.removed || [] });
        if (body.deleteFiles) await checkVllm().catch(() => null);
        return { ok: true, message: `${e.label} is out of the list.${deleted}${warn || ''}` };
    }
    // vLLM's own log, its last lines (the panel's Show the log).
    async function vllmLog(lines = 200) {
        const n = Math.max(10, Math.min(1000, Math.round(Number(lines)) || 200));
        if (!vllmTarget && vllmSup.ok) await checkVllm().catch(() => null);
        if (!vllmTarget) return { ok: true, lines: [] };
        const r = await vllmMod.readLog(vllmTarget, { lastLines: n });
        return { ok: true, lines: r.text ? r.text.split('\n') : [] };
    }
    // "Use this" while another engine serves: the model a switch to vLLM will serve. It must be downloaded.
    function chooseVllmModel(id) {
        const e = (config.vllm.library || []).find((x) => x.id === id);
        if (!e) return { ok: false, error: 'That model is not in the vLLM list.' };
        if (e.id === config.vllm.model) return { ok: true, already: true, message: `${e.label} is already the one vLLM serves.` };
        const st = vllmProbe && vllmProbe.st;
        const m = st && st.models.find((f) => f.folder === vllmMod.folderOf(e));
        if (!m || m.partial) return { ok: false, error: `${e.label} is not downloaded yet: press Download next to it.` };
        config.vllm.model = e.id;
        const warn = persist('vllm', { model: e.id });
        return { ok: true, message: `vLLM will serve ${e.label} when you switch to it.${warn || ''}` };
    }

    // Persist a name plan from carryNameAcross (litellm.js — the pure half, where the
    // rule and its tests live). Only an operator's engine SWITCH persists names; a
    // fallback applies its plan in memory only (engineFallback).
    function persistNamePlan(plan) {
        if ('vllmAlias' in plan) persist('vllm', { alias: plan.vllmAlias });
        if ('externalAlias' in plan) persist('external', { alias: plan.externalAlias });
        if ('llamacppAlias' in plan) persist('llamacpp', { alias: plan.llamacppAlias });
        if ('modelAlias' in plan) patchConfigFile(configPath, (raw) => { raw.modelAlias = plan.modelAlias; return raw; });
        if ('defaultAlias' in plan) persistModels();
    }

    // A llama.cpp rename also renames the standby Ollama default when that default
    // carries its OWN alias (carried there by an earlier switch): a switch back — or a
    // crash fallback, which keeps an operator's own Ollama name — would otherwise serve
    // the stale one. Returns an undo for the rename's rollback path.
    function syncStandbyDefaultName(name) {
        const def = defaultModelEntry(config);
        const prev = def && (def.alias || '').trim();
        if (!def || !prev || prev === name) return () => {};
        if (config.models.some((m) => m !== def && ((m.alias || '').trim() || m.id) === name)) return () => {};
        def.alias = name;
        persistModels();
        return () => { def.alias = prev; persistModels(); };
    }

    // The refusal every engine knob gives while a server the farm does not run serves: its model, window and
    // concurrency are its own (§7.7, in plain words: no config key reaches the operator, D10).
    function externalRefusal() {
        return { ok: false, error: `This farm routes to a server it does not run, so its model, context and people at once are that server's own. To change them here, switch to Ollama, llama.cpp or vLLM.` };
    }

    // Swap the .gguf llama-server loads: either a library entry (`id`) or any .gguf URL
    // (`url`), which is what makes "add a model" a real operation and not a config edit.
    // Rolls the config back and reloads the previous weights if the new ones don't come
    // up — a mistyped URL must not leave the farm with no backend.
    // While another engine serves, it CHOOSES the model a switch to llama.cpp will serve (owner, 2026-10-09): the
    // download runs now as the job, and the engine that serves keeps serving.
    function setLlamacppModel(sel) {
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
        const serving = engineOf(config) === 'llamacpp';
        if (url === config.llamacpp.model && (serving || llamacpp.onDisk(url))) return { ok: true, already: true, model: url };

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
        if (!serving) {
            return runJob('model', `Downloading ${label}`, async (progress) => {
                let got;
                try { got = await llamacpp.ensureModel({ ...config, llamacpp: { ...config.llamacpp, ...patch } }, progress); }
                catch (err) { got = { ok: false, message: `Could not download it: ${(err && err.message) || err}` }; }
                if (!got.ok) return { ok: false, error: `${got.message} Nothing changed.` };
                const warn = persistLlamacpp(patch);
                return { ok: true, message: `llama.cpp will serve ${label} when you switch to it. ${ENGINE_NAMES[engineOf(config)].replace(/^the e/, 'The e')} keeps serving until then.${mtpNote}${warn || ''}` };
            });
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
                ? ` ⚠ This shape needs ~${f.needGb} GB of the ${f.vramGb} GB free on the GPU — expect it to run slowly.`
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

    // How many people this box serves AT ONCE. On llama.cpp this is --parallel; the
    // slots share one --ctx-size pool under kvUnified (the default — contextLength /
    // slots is then the guaranteed floor), or split it hard with kvUnified:false
    // (verified: 16384 / 2 -> n_ctx_slot 8192), and the caller is told which. On Ollama it is
    // OLLAMA_NUM_PARALLEL, which only applies to an Ollama this CLI starts — so there it
    // needs a farm restart, not a proxy bounce, and we say so instead of pretending.
    function setSlots(count) {
        if (engineOf(config) === 'vllm') return applyFarmSettings({ slots: count });   // its own bounds (1–512) and rules
        const want = Math.round(Number(count));
        if (!Number.isFinite(want) || want < 1 || want > 16) return { ok: false, error: 'Slots must be between 1 and 16.' };
        // An external server's concurrency is its own (external.parallel only
        // DECLARES it). Writing ollama.numParallel here reported success for a change
        // that did nothing while the seats kept using external.parallel.
        if (config.external.enabled) return externalRefusal();
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
            return {
                ok: true,
                message: config.llamacpp.kvUnified !== false
                    ? `${want} slot(s) sharing one ${ctxNum}-token context pool (${perSlot} guaranteed each).${warn || ''}`
                    : `${want} slot(s), ${perSlot} tokens of context each.${warn || ''}`,
            };
        });
    }

    // The model NAME users read. Over an OpenAI connection the id from /v1/models IS what
    // a picker displays, so this is the served alias, not a cosmetic label — which is
    // also why renaming asks existing chats to re-select the model.
    function setAdvertisedName(name) {
        // The external engine's name is external.alias in the config file.
        if (config.external.enabled) return externalRefusal();
        if (engineOf(config) === 'vllm') return applyFarmSettings({ name });
        if (busy()) return busyErr();
        const clean = String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').trim().slice(0, 48);
        if (!clean) return { ok: false, error: 'Give the model a name.' };
        if (NAME_BAD_RX.test(clean)) return { ok: false, error: 'Use letters, numbers, spaces and . - + : only.' };
        if (!config.llamacpp.enabled) {
            // Ollama side: the global alias re-binds the routing; no model reload needed.
            if (clean === (config.modelAlias || '')) return { ok: true, already: true, name: clean };
            const before = config.modelAlias;
            // The file's own value (memory may hold a fallback's name — never write it).
            const rawBefore = readRawConfig(configPath) || {};
            const diskAlias = 'modelAlias' in rawBefore ? { v: rawBefore.modelAlias } : null;
            // A per-model alias on the DEFAULT model outranks modelAlias in the
            // routing (servedEntries), so left in place it would silently swallow
            // this rename. The most recent action wins: clear it.
            const defEntry = defaultModelEntry(config);
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
                    patchConfigFile(configPath, (raw) => {
                        if (diskAlias) raw.modelAlias = diskAlias.v; else delete raw.modelAlias;
                        return raw;
                    });
                    await restartProxy();
                    return { ok: false, error: 'The proxy did not come back — kept the previous name.' };
                }
                if (beacon) beacon.kick();
                return { ok: true, message: `Users now see "${clean}".${notSaved(saved) || ''}` };
            });
        }
        if (clean === config.llamacpp.alias) return { ok: true, already: true, name: clean };
        const before = config.llamacpp.alias;
        return runJob('name', `Renaming the model to "${clean}"`, async (progress) => {
            const warn = persistLlamacpp({ alias: clean });
            const unsync = syncStandbyDefaultName(clean);
            const r = await reloadLlamacpp(progress);
            if (!r.ok) {
                persistLlamacpp({ alias: before });
                unsync();
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
        const isDefault = entry === defaultModelEntry(config);
        // While llama.cpp serves, the Ollama DEFAULT's name is not its own: a switch
        // back gives it llama.cpp's name (carryNameAcross) so bound chats keep working.
        // A standby rename here would be silently overwritten — say where it lives.
        const serving = engineOf(config);
        if ((serving === 'llamacpp' || serving === 'vllm') && isDefault) {
            const eng = serving === 'vllm' ? 'vLLM' : 'llama.cpp';
            return { ok: false, error: `${entry.id} is the Ollama default — on a switch back to Ollama it takes the name ${eng} serves ("${config[serving].alias}"). Rename it under Backend ▸ Name users see.` };
        }
        const clean = String(alias == null ? '' : alias).replace(/[\r\n\t]/g, ' ').trim().slice(0, 48) || null;
        if (clean && NAME_BAD_RX.test(clean)) return { ok: false, error: 'Use letters, numbers, spaces and . - + : only.' };
        if (clean) {
            // The name IS the id clients request — a duplicate silently merges two
            // models into one route (the alias-hygiene rule, enforced here). The
            // serving engine's name is reserved for the default: it is what the
            // default carries back on a switch or a fallback.
            const taken = config.models.some((m) => m !== entry && ((m.alias || '').trim() || m.id) === clean)
                || (config.llamacpp.enabled && clean === config.llamacpp.alias)
                || (engineOf(config) === 'vllm' && clean === config.vllm.alias)
                || (config.external.enabled && !isDefault && clean === config.external.alias)
                || (!isDefault && clean === (config.modelAlias || '').trim());
            if (taken) return { ok: false, error: `"${clean}" is already another model's name.` };
        }
        if (((entry.alias || '').trim() || null) === clean) return { ok: true, already: true };
        const before = (entry.alias || '').trim() || null;
        const apply = (v) => { if (v) entry.alias = v; else delete entry.alias; };
        // Standby catalog (llama.cpp or an external server serving): nothing here is
        // routed, so persist without bouncing the proxy — the name applies when
        // Ollama is the engine again.
        if (!ollamaServes(config)) {
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
            sendBusKey(svcById.bus.child, config.proxy.masterKey);   // the bus hears a new password now, not at the next tick (critic N1)
            return { ok: true, message: clean
                ? `Password set. Clients now ask for it before connecting.${warn || ''}`
                : `Password removed — the farm is open to the LAN again.${warn || ''}` };
        });
    }

    // ONE Apply for the settings block (owner ask 2026-08-31): name + slots +
    // password + context used to be four buttons, each with its own restart — four
    // model reloads to change four things. This applies whatever subset the panel
    // sends in ONE job with ONE restart chain. Field semantics match the individual
    // controls exactly (which stay, for API compatibility and the password-clear
    // flow). `password` here only SETS — clearing keeps its own confirmed control.
    // `seatIdleSec` (the seat hold) is the one field that never needs a restart.
    function applyFarmSettings(body = {}) {
        if (busy()) return busyErr();
        if (engineOf(config) === 'vllm') return applyVllmSettings(body);
        if (body.model != null) return chooseVllmModel(body.model);   // the vLLM list's Use this, while another engine serves
        // Under an external server only the password applies (it gates the farm's own
        // proxy); name, slots and context are that server's, declared in the file.
        if (config.external.enabled
            && ((body.name != null && String(body.name).trim() !== '') || body.slots != null || body.context != null)) {
            return externalRefusal();
        }
        const lcMode = !!config.llamacpp.enabled;
        // Validate everything BEFORE touching anything; normalize no-ops to null.
        let name = null;
        if (body.name != null && String(body.name).trim() !== '') {
            name = String(body.name).replace(/[\r\n\t]/g, ' ').trim().slice(0, 48);
            if (NAME_BAD_RX.test(name)) return { ok: false, error: 'Name: use letters, numbers, spaces and . - + : only.' };
            if (name === (lcMode ? config.llamacpp.alias : (config.modelAlias || ''))) name = null;
        }
        let slots = null;
        if (body.slots != null) {
            slots = Math.round(Number(body.slots));
            if (!Number.isFinite(slots) || slots < 1 || slots > 16) return { ok: false, error: 'Slots must be between 1 and 16.' };
            if (slots === (lcMode ? config.llamacpp.parallel : config.ollama.numParallel)) slots = null;
        }
        let password;   // undefined = untouched
        if (typeof body.password === 'string' && body.password.trim() !== '') {
            password = body.password.trim().slice(0, 128);
            if ((config.proxy.masterKey || null) === password) password = undefined;
        }
        let context = null;   // 'auto' | number | null
        if (body.context != null) {
            const curCl = lcMode ? config.llamacpp.contextLength : config.ollama.contextLength;
            if (body.context === 'auto') {
                context = curCl === 'auto' ? null : 'auto';
            } else {
                const want = Math.round(Number(body.context));
                const nativeCap = lcMode ? (((computeFit() || {}).nativeMax) || null) : ollamaNativeMax();
                const hardCap = nativeCap || 4194304;
                if (!Number.isFinite(want) || want < 2048 || want > hardCap) {
                    return { ok: false, error: `Context must be between 2048 and ${hardCap} tokens${nativeCap ? " (this model's maximum)" : ''}.` };
                }
                context = want === curCl ? null : want;
            }
        }
        // The seat hold is the gate's, not the engine's — it applies under any engine.
        const idle = seatIdleChange(config, configPath, body.seatIdleSec);
        if (idle && idle.error) return { ok: false, error: idle.error };
        if (name == null && slots == null && password === undefined && context == null) {
            if (!idle) return { ok: true, already: true, message: 'Nothing changed.' };
            // Alone it restarts nothing: the gate reads it live, and so does the snapshot.
            const warn = idle.apply();
            if (beacon) beacon.kick();
            return { ok: true, message: `Applied at once, no restart: ${idle.label}.${warn || ''}` };
        }
        // With other changes it lands only once their restart succeeded, so a rollback
        // ("nothing changed") stays true.
        return runJob('settings', 'Applying the farm settings', async (progress) => {
            const applied = [];
            if (lcMode) {
                const beforeLc = { alias: config.llamacpp.alias, parallel: config.llamacpp.parallel, contextLength: config.llamacpp.contextLength };
                const beforePw = config.proxy.masterKey || null;
                const patch = {};
                if (name != null) { patch.alias = name; applied.push(`name "${name}"`); }
                if (slots != null) { patch.parallel = slots; applied.push(`${slots} slot(s)`); }
                if (context != null) { patch.contextLength = context; applied.push(context === 'auto' ? 'context automatic' : `context ${context}`); }
                if (password !== undefined) { config.proxy.masterKey = password; persist('proxy', { masterKey: password }); applied.push('password set'); }
                if (Object.keys(patch).length) persistLlamacpp(patch);
                const unsync = name != null ? syncStandbyDefaultName(name) : () => {};
                let ok, err;
                if (Object.keys(patch).length) {
                    const r = await reloadLlamacpp(progress);   // reload covers alias/slots/ctx AND bounces the proxy (password rides along)
                    ok = r.ok; err = r.error;
                } else {
                    ok = await restartProxy(); err = 'The proxy did not come back.';
                }
                if (!ok) {
                    persistLlamacpp(beforeLc);
                    unsync();
                    config.proxy.masterKey = beforePw;
                    persist('proxy', { masterKey: beforePw ?? undefined });
                    if (Object.keys(patch).length) await reloadLlamacpp(() => {}); else await restartProxy();
                    return { ok: false, error: `${err} Reverted — nothing changed.` };
                }
                if (idle) { idle.apply(); applied.push(idle.label); }
                if (beacon) beacon.kick();
                sendBusKey(svcById.bus.child, config.proxy.masterKey);   // the bus hears a new password now, not at the next tick (critic N1)
                return { ok: true, message: `Applied in one restart: ${applied.join(' · ')}.` };
            }
            // Ollama engine: everything lands in the routing → ONE proxy bounce.
            const before = {
                modelAlias: config.modelAlias, numParallel: config.ollama.numParallel,
                cl: config.ollama.contextLength, res: config.ollama.contextResolved ?? null,
                pw: config.proxy.masterKey || null,
            };
            // What the FILE held, so a rollback restores the file exactly — memory can
            // carry a fallback's name (engineFallback) that must never be written.
            const rawBefore = readRawConfig(configPath) || {};
            const diskAlias = 'modelAlias' in rawBefore ? { v: rawBefore.modelAlias } : null;
            const defEntry = defaultModelEntry(config);
            const defAliasBefore = (defEntry && (defEntry.alias || '').trim()) || null;
            let needsFarmRestart = false;
            if (name != null) {
                // A per-model alias on the default outranks modelAlias — latest rename wins.
                if (defEntry && defAliasBefore) { delete defEntry.alias; persistModels(); }
                config.modelAlias = name;
                patchConfigFile(configPath, (raw) => { raw.modelAlias = name; return raw; });
                applied.push(`name "${name}"`);
            }
            if (slots != null) {
                config.ollama.numParallel = slots;
                persist('ollama', { numParallel: slots });
                needsFarmRestart = true;
                applied.push(`${slots} at once (after a farm restart)`);
            }
            if (password !== undefined) { config.proxy.masterKey = password; persist('proxy', { masterKey: password }); applied.push('password set'); }
            if (context != null) {
                if (context === 'auto') {
                    config.ollama.contextLength = 'auto';
                    config.ollama.contextResolved = null;
                    persist('ollama', { contextLength: 'auto' });
                    dropOllamaCtxCache();
                    await resolveOllamaContext(progress);
                    applied.push(`context automatic (now ${config.ollama.contextResolved})`);
                } else {
                    config.ollama.contextLength = context;
                    config.ollama.contextResolved = context;
                    persist('ollama', { contextLength: context });
                    applied.push(`context ${context}`);
                }
            }
            progress('reloading routing', null);
            if (!(await restartProxy())) {
                // Revert only what this Apply changed: writing untouched values back
                // would freeze today's defaults into the operator's file.
                if (name != null) {
                    config.modelAlias = before.modelAlias;
                    if (defEntry && defAliasBefore) { defEntry.alias = defAliasBefore; persistModels(); }
                    patchConfigFile(configPath, (raw) => {
                        if (diskAlias) raw.modelAlias = diskAlias.v; else delete raw.modelAlias;
                        return raw;
                    });
                }
                if (slots != null) {
                    config.ollama.numParallel = before.numParallel;
                    persist('ollama', { numParallel: before.numParallel });
                }
                if (password !== undefined) {
                    config.proxy.masterKey = before.pw;
                    persist('proxy', { masterKey: before.pw ?? undefined });
                }
                if (context != null) {
                    config.ollama.contextLength = before.cl;
                    config.ollama.contextResolved = before.res;
                    persist('ollama', { contextLength: before.cl });
                }
                await restartProxy();
                return { ok: false, error: 'The proxy did not come back — reverted everything.' };
            }
            if (idle) { idle.apply(); applied.push(idle.label); }
            if (beacon) beacon.kick();
            sendBusKey(svcById.bus.child, config.proxy.masterKey);   // the bus hears a new password now, not at the next tick (critic N1)
            return { ok: true, needsFarmRestart, message: `Applied in one restart: ${applied.join(' · ')}.` };
        });
    }

    // Apply on vLLM (§5.6): name, people at once, context per person, GPU memory for conversations, model, password,
    // the idle seat. vllm.js applyChange decides (D9: what vLLM runs with, against the effective new launch): a new
    // model, context, memory or vLLM request cap restarts vLLM (about 2 minutes), while people at once inside the
    // cap, the name and the password apply in seconds. `dryRun` answers {restart, changes} and changes nothing (the
    // panel confirms a restart first). A restart that fails goes back to the previous settings; if those fail too,
    // Ollama serves.
    function applyVllmSettings(body = {}) {
        const v = config.vllm;
        const st = vllmProbe && vllmProbe.st;
        let name = null;
        if (body.name != null && String(body.name).trim() !== '') {
            name = String(body.name).replace(/[\r\n\t]/g, ' ').trim().slice(0, 48);
            if (NAME_BAD_RX.test(name)) return { ok: false, error: 'Name: use letters, numbers, spaces and . - + : only.' };
        }
        const L = vllmState.launchSettings;
        const running = vllmState.phase === 'ready' && !!L;
        const c = vllmMod.applyChange(config, { ...body, name }, { st, launch: running ? L : null, root: vllmTarget && vllmTarget.root });
        if (c.error) return { ok: false, error: c.error };
        const { patch, restart } = c;
        const seatsEff = c.seats;
        const changes = c.changes.slice();
        let password;   // undefined = untouched
        if (typeof body.password === 'string' && body.password.trim() !== '') {
            password = body.password.trim().slice(0, 128);
            if ((config.proxy.masterKey || null) === password) password = undefined;
        }
        const idle = seatIdleChange(config, configPath, body.seatIdleSec);
        if (idle && idle.error) return { ok: false, error: idle.error };
        if (password !== undefined) changes.push('password set');
        if (!changes.length) {
            if (body.dryRun) return { ok: true, dryRun: true, restart: false, changes: idle ? [idle.label] : [] };
            if (!idle) return { ok: true, already: true, message: 'Nothing changed.' };
            const warn = idle.apply();
            kickBox.fn();
            return { ok: true, message: `Applied at once, no restart: ${idle.label}.${warn || ''}` };
        }
        if (body.dryRun) return { ok: true, dryRun: true, restart, changes: changes.concat(idle ? [idle.label] : []) };
        return runJob('settings', 'Applying the farm settings', async (progress) => {
            const before = Object.fromEntries(Object.keys(patch).map((k) => [k, v[k]]));
            const rawV = (readRawConfig(configPath) || {}).vllm || {};
            const beforePw = config.proxy.masterKey || null;
            const warn = persist('vllm', patch);
            Object.assign(v, patch);
            if (password !== undefined) { config.proxy.masterKey = password; persist('proxy', { masterKey: password }); }
            const revert = () => {   // memory, and the file exactly as it was
                Object.assign(v, before);
                persist('vllm', Object.fromEntries(Object.keys(patch).map((k) => [k, k in rawV ? rawV[k] : undefined])));
                if (password !== undefined) { config.proxy.masterKey = beforePw; persist('proxy', { masterKey: beforePw ?? undefined }); }
            };
            const done = (msg) => {
                if (idle) { idle.apply(); changes.push(idle.label); }
                kickBox.fn();
                sendBusKey(svcById.bus.child, config.proxy.masterKey);
                return { ok: true, message: `${msg}: ${changes.join(' · ')}.${warn || ''}` };
            };
            if (!restart) {
                if (running && 'parallel' in patch) v.parallelResolved = seatsEff;   // the gate's seats, live
                if ('alias' in patch || password !== undefined) {
                    progress('reloading routing', null);
                    if (!(await restartProxy())) { revert(); await restartProxy(); return { ok: false, error: 'The proxy did not come back. Reverted: nothing changed.' }; }
                }
                return done(running ? 'Applied without restarting vLLM' : 'Saved, for the next start of vLLM');
            }
            progress('stopping vLLM', null);
            setVllmPhase('stopping');
            const stopped = await stopVllmProcess();
            if (!stopped.ok) { revert(); setVllmPhase('ready'); return { ok: false, error: `${stopped.error} Nothing changed.` }; }
            let r = await startVllm(progress);
            if (r.ok) {
                progress('reloading routing', null);
                if (!(await restartProxy())) r = { ok: false, message: 'The proxy did not come back.' };
            }
            if (r.ok) return done('Applied in one restart of vLLM');
            progress('going back to the previous settings', null);
            revert();
            const back = await startVllm(progress);
            if (!back.ok) {
                if (!(await fallbackToOllama(`${r.message} The previous settings did not come back either: ${back.message}`, { portIsOthers: !!back.portIsOthers, ran: !!(r.ran || back.ran) }))) return { ok: false, error: vllmState.text };
                return { ok: false, error: `${r.message} The previous settings did not come back either (${back.message}): the farm serves with Ollama for now.` };
            }
            await restartProxy();
            return { ok: false, error: `${r.message} Back to the previous settings.` };
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
            for (let hi = 0; hi < targets.length; hi++) {
                const h = targets[hi];
                let failed = null;
                // /api/pull reports progress PER LAYER (one blob per digest), and
                // passing that straight through is what made this feel broken: the
                // bar restarted from zero at every layer and the byte figure was
                // that layer's, so a 30 GB pull looked like it kept starting over
                // (owner report 2026-09-10). Aggregate instead — sum every digest
                // seen so far — the same shape the split-GGUF path already uses.
                // Ollama only reveals a layer when it starts, so the denominator can
                // grow; the weights blob dominates, so in practice it settles after
                // the first one. The rate meter is what answers "is it moving?".
                const layers = new Map();   // digest -> { total, completed }
                const hostPrefix = targets.length > 1 ? `box ${hi + 1}/${targets.length}: ` : '';
                await ollama.pullModel(h, want, (line) => {
                    if (!line || typeof line !== 'object') return;
                    if (line.error) failed = line.error;
                    if (line.digest && line.total > 0) {
                        layers.set(line.digest, { total: line.total, completed: Math.max(0, line.completed || 0) });
                    }
                    let done = 0; let total = 0;
                    for (const l of layers.values()) { done += l.completed; total += l.total; }
                    const pct = total > 0 ? (done / total) * 100 : null;
                    // Never echo a raw digest ("pulling 8934d96d3f08" means nothing to
                    // the person waiting) — name the phase and let the numbers carry
                    // the detail.
                    progress(`${hostPrefix}${pullPhase(line.status)}`, pct,
                        total > 0 ? { bytes: done, total } : null);
                }).catch((e) => { failed = String((e && e.message) || e); });
                if (failed) {
                    // Ollama's registry refuses split GGUF repos outright — point the
                    // operator at the path that CAN serve them instead of dead-ending.
                    const hint = /sharded/i.test(failed)
                        ? ' This repo is a SPLIT .gguf, which Ollama cannot pull. Switch Backend to llama.cpp first, then use Model · llama.cpp ▸ Add a model with the file\'s download URL — the farm fetches all parts.'
                        : '';
                    return { ok: false, error: `Could not pull "${want}": ${failed}${hint}` };
                }
            }
            // gemma4:12b downloaded while another engine serves becomes the model that reads documents (§1.4).
            await readOcrInstalled();
            await refreshOcrModel();
            // Serve it too — an "add a model" that leaves the model invisible to clients
            // is not what anyone means by adding a model. This restarts the proxy, so
            // say so: it is the several-second tail an operator otherwise reads as a
            // hang right after the bar hits 100%.
            // Standby (llama.cpp or an external server serving): the catalog is not
            // routed, so the routing would come out identical — a proxy restart would
            // only drop everyone's in-flight chats (502 while LiteLLM comes back), and a
            // keep_alive -1 warm-up would pin the model next to the serving engine.
            if (!ollamaServes(config)) {
                progress('adding it to the catalog', null);
                const known = config.models.some((m) => norm(m.id) === norm(want));
                const warnS = known ? null : standbyModels(config.models.concat([{ id: want }]));
                return { ok: true, standby: true, message: `${want} downloaded to this box.${standbyNote()}${warnS || ''}` };
            }
            progress('adding it to the served models', null);
            if (!config.models.some((m) => norm(m.id) === norm(want))) {
                if (!(await applyModels(config.models.concat([{ id: want }])))) {
                    return { ok: false, error: `Downloaded ${want}, but the proxy did not come back — it is not being served.` };
                }
            }
            const warn = persistModels();
            for (const h of targets) ollama.warmModel(h, want, config.ollama.keepAlive, ollamaCtxNum()).catch(() => {});
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
        if (config.ocr.enabled && norm(resolveOcrModel(config, ocrInstalled)) === norm(want)) {
            return { ok: false, error: 'Document reading uses this model: turn document reading off first, or download another model that sees images.' };
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
            await readOcrInstalled();
            const warn = persistModels();
            if (beacon) beacon.kick();
            if (failures.length) return { ok: false, error: `Un-served, but the files could not be deleted — ${failures.join('; ')}` };
            return { ok: true, message: `${want} removed.${warn || ''}` };
        });
    }

    // Serialize mutations (jobs.serialize): the admin page's client-side `busy` flag doesn't
    // bind a second browser tab, another device sharing the token, or a curl script, and two
    // overlapping restarts share `restartingProxy` — one's finally clears it while the other is
    // still mid-restart, which could unmask onProxyExit and tear the farm down. A single
    // in-flight chain makes start/stop/plugin-toggle atomic regardless of how many callers hit.
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
        applyFarmSettings,
        pullOllamaModel,
        removeOllamaModel,
        // vLLM (docs/VLLM_MANAGED_PLAN.md): the check runs on request only; start and stop are jobs; a download
        // is in its own slot; Stop on either slot cancels (job/cancel).
        vllmCheck,
        vllmStart,
        vllmStop,
        vllmDownload,
        vllmInstall,
        vllmLibraryAdd: (b) => busy() ? busyErr() : serialize(() => vllmLibraryAdd(b)),
        vllmLibraryRemove: (b) => busy() ? busyErr() : serialize(() => vllmLibraryRemove(b)),
        vllmLog,
        // "Let the farm run vLLM" and its Undo (§9): a few seconds each, or a start job when nothing runs.
        vllmTakeOver: () => (busy() ? busyErr() : serialize(() => vllmTakeOverRun())),
        vllmUndoTakeOver: () => (busy() ? busyErr() : serialize(() => vllmUndoTakeOver())),
        cancel: (slot) => (slot === 'download' ? cancelDownload() : jobs.cancel('job')),
    });
    engineDownBox.fn = onEngineDown;   // serialize + liveHealth exist now — arm supervision
    // vLLM: watched from now on, and the start the boot queued runs as the job everyone sees (D5).
    watchVllm();
    if (vllmBootJob) startVllmJob('Starting vLLM', { waitOnly: vllmBootJob === 'wait' });
    // A vLLM on this computer that the farm routes to as an external server: the panel offers to run it (§9).
    void detectTakeOver().catch((e) => log.warn(`Looking for a vLLM the farm could run: ${e.message}`));
    // If llama-server died DURING the boot window (between its health-OK and
    // this line — proxy/plugin startup can take a minute), the exit handler
    // found fn null and only cleared llamacppChild. Handle it now instead of
    // advertising unhealthy forever with no restart and no reason.
    if (engineOf(config) === 'llamacpp' && !llamacppChild) onEngineDown(-1);
    engineDownBox.markUp = () => { liveHealth.engineUp = true; if (beacon) beacon.kick(); };

    // Keep the event loop alive.
    return new Promise(() => {});
}

// makeRateMeter/pullPhase/makePerfSampler/seatIdleChange/autoLlamacppContext are exported for
// the tests: each encodes judgements that are easy to break silently (a negative rate after a
// restart, a raw digest leaking into the UI, a non-vLLM read as one, a seat hold out
// of range, a "nothing fits" read as "unknown") and none is reachable through `run`.
module.exports = { run, resolveOcrModel, makeRateMeter, makeJobs, pullPhase, makePerfSampler, seatIdleChange, autoLlamacppContext };
