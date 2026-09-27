// Farm-plugin registry — the single place that knows the farm-side optional services
// (web search / voice / OCR). Each is a descriptor that DELEGATES to its existing
// module (searxng.js / kokoro.js / extract.js) — the install/spawn/health internals are
// untouched (and rig-verified); this only unifies the ORCHESTRATION so that boot, live
// toggling (control.setPlugin), the health timer, teardown, and the snapshot all iterate
// one list instead of three copy-pasted blocks.
//
// A FarmService instance owns the child + its up-state + per-run ctx (e.g. the OCR
// bearer key). `start()` returns a { ok, level, message } the caller logs, so the exact
// per-service wording is preserved. `onDown` fires if a running plugin's child later
// exits (advertise-off). Client-side plugins (Blender) are NOT here — they run in the
// desktop app; the farm only *recommends* them (config.recommendedClientPlugins).

const { killTree } = require('../proc');
const searxng = require('../searxng');
const kokoro = require('../kokoro');
const extract = require('../extract');
const classify = require('../classify');
const stt = require('../stt');
const { serviceHosts } = require('../net');

// Where the farm's own health checks reach a plugin: the plugins bind where
// config.proxy.host says (LAN, loopback, or one specific address), so a probe at a
// hard-coded 127.0.0.1 would call a specifically-bound plugin dead.
const probeHost = (c) => serviceHosts(c.proxy && c.proxy.host).probe;
// The Windows Firewall prompt only appears for a LAN bind — not on a private farm.
const firewallNote = (c) => (serviceHosts(c.proxy && c.proxy.host).loopback
    ? ' (private: this machine only)'
    : ' (first LAN bind may show a Windows Firewall prompt: allow it)');

// Each descriptor delegates to an existing module; see the header. `runtime` (passed to
// start/makeCtx) carries { log, crypto, resolveOcrModel, isLocalHost, reachable }.
const DESCRIPTORS = [
    {
        id: 'websearch', label: 'Web search', logPrefix: 'searxng', configKey: 'websearch', healthKey: 'searxngUp', runsOn: 'farm',
        enabled: (c) => !!(c.websearch && c.websearch.enabled),
        port: (c) => c.websearch.port,
        ensure: () => searxng.ensureSearxng(),
        spawn: (c) => searxng.spawnSearxng(c),
        stepMessage: (c) => `Web search: preparing SearXNG (port ${c.websearch.port}) …`,
        waitReady: async (c) => {
            const sx = await searxng.waitForSearxng(c.websearch.port, undefined, probeHost(c));
            if (sx.up && sx.jsonOk) return { ok: true, level: 'ok', message: `SearXNG up — clients get web search automatically${firewallNote(c)}.` };
            if (sx.up && !sx.jsonOk) return { ok: false, level: 'err', message: 'SearXNG is up but the JSON API is off (OWUI would get 403) — delete farm/.searxng/settings.yml and re-run `lol up`.' };
            return { ok: false, level: 'warn', message: `SearXNG did not become healthy on port ${c.websearch.port} (busy port? see the [searxng] log above). Continuing without web search.` };
        },
        alive: (c) => searxng.searxngAlive(c.websearch.port, probeHost(c)),
    },
    {
        id: 'tts', label: 'Voice (TTS)', logPrefix: 'kokoro', configKey: 'tts', healthKey: 'ttsUp', runsOn: 'farm',
        enabled: (c) => !!(c.tts && c.tts.enabled),
        port: (c) => c.tts.port,
        ensure: () => kokoro.ensureKokoro(),
        spawn: (c) => kokoro.spawnKokoro(c),
        stepMessage: (c) => `Voice: preparing Kokoro TTS (port ${c.tts.port}) — first run installs it (multi-GB) …`,
        waitReady: async (c) => {
            const kx = await kokoro.waitForKokoro(c.tts.port, c.tts.voice, undefined, probeHost(c));
            if (kx.up && kx.synthOk) return { ok: true, level: 'ok', message: `Kokoro TTS up (voice ${c.tts.voice}) — clients get neural read-aloud automatically.` };
            if (kx.up) return { ok: false, level: 'err', message: 'Kokoro is up but synthesis failed — voice/model/espeak issue. See the [kokoro] log above.' };
            return { ok: false, level: 'warn', message: `Kokoro did not become healthy on port ${c.tts.port} (busy port? warmup slow? see [kokoro] log). Continuing without voice.` };
        },
        alive: (c) => kokoro.kokoroAlive(c.tts.port, probeHost(c)),
    },
    {
        id: 'ocr', label: 'Document OCR', logPrefix: 'extract', configKey: 'ocr', healthKey: 'extractUp', runsOn: 'farm',
        enabled: (c) => !!(c.ocr && c.ocr.enabled),
        port: (c) => c.ocr.port,
        makeCtx: (c, rt) => {
            // Prefer a normalized + confirmed-reachable host (rt.reachable); fall back to config.
            const hosts = (rt.reachable && rt.reachable.length) ? rt.reachable : c.ollama.hosts;
            const localOllama = hosts.find(rt.isLocalHost) || hosts[0];
            return { key: rt.crypto.randomBytes(24).toString('hex'), model: rt.resolveOcrModel(c), ollamaUrl: localOllama.replace(/\/+$/, '') + '/api/generate' };
        },
        ensure: (c) => extract.ensureExtract(c),
        spawn: (c, ctx) => extract.spawnExtract(c, ctx),
        stepMessage: (c, ctx) => `OCR: preparing document extraction (port ${c.ocr.port}, model ${ctx.model}) — first run installs it …`,
        waitReady: async (c, ctx) => {
            const ex = await extract.waitForExtract(c.ocr.port, undefined, probeHost(c));
            if (ex.up) return { ok: true, level: 'ok', message: `OCR up (model ${ctx.model}) — clients get scanned-doc + image OCR automatically${firewallNote(c)}.` };
            return { ok: false, level: 'warn', message: `OCR service did not become healthy on port ${c.ocr.port} (busy port? slow first install? see the [extract] log). Continuing without OCR.` };
        },
        alive: (c) => extract.extractAlive(c.ocr.port, probeHost(c)),
    },
    {
        // Ecosystem plan v2 §3.2: Laya for the Computer's Classify box. CPU-first, off by default.
        id: 'classify', label: 'Classify (Laya)', logPrefix: 'classify', configKey: 'classify', healthKey: 'classifyUp', runsOn: 'farm',
        enabled: (c) => !!(c.classify && c.classify.enabled),
        port: (c) => c.classify.port,
        makeCtx: (c, rt) => ({ key: rt.crypto.randomBytes(24).toString('hex') }),
        ensure: () => classify.ensureClassify(),
        spawn: (c, ctx) => classify.spawnClassify(c, ctx),
        stepMessage: (c) => `Classify: preparing Laya on the CPU (port ${c.classify.port}) — first run installs torch + downloads its weights …`,
        waitReady: async (c, ctx, isDead) => {
            const cx = await classify.waitForClassify(c.classify.port, undefined, probeHost(c), isDead);
            if (cx.error) return { ok: false, level: 'warn', message: `Classify could not load Laya (${cx.error}). Continuing without it.` };
            if (cx.up) return { ok: true, level: 'ok', message: `Classify up (Laya ${classify.LAYA_VERSION}, CPU) — the Computer's Classify box works on this farm${firewallNote(c)}.` };
            return { ok: false, level: 'warn', message: `Classify did not become ready on port ${c.classify.port} (download or load still running? see the [classify] log). Continuing without it.` };
        },
        alive: (c) => classify.classifyAlive(c.classify.port, probeHost(c)),
    },
    {
        // Ecosystem plan v2 §3.3: speech to text for the Computer's Sound box (Listen). CPU, off by default.
        id: 'stt', label: 'Speech to text', logPrefix: 'stt', configKey: 'stt', healthKey: 'sttUp', runsOn: 'farm',
        enabled: (c) => !!(c.stt && c.stt.enabled),
        port: (c) => c.stt.port,
        makeCtx: (c, rt) => ({ key: rt.crypto.randomBytes(24).toString('hex') }),
        ensure: () => stt.ensureStt(),
        spawn: (c, ctx) => stt.spawnStt(c, ctx),
        stepMessage: (c) => `Speech to text: preparing faster-whisper "${c.stt.model}" on the CPU (port ${c.stt.port}) — first run installs it and downloads the model …`,
        waitReady: async (c, ctx, isDead) => {
            const sx = await stt.waitForStt(c.stt.port, undefined, probeHost(c), isDead);
            if (sx.error) return { ok: false, level: 'warn', message: `Speech to text could not load its model (${sx.error}). Continuing without it.` };
            if (sx.up) return { ok: true, level: 'ok', message: `Speech to text up (faster-whisper ${c.stt.model}, CPU) — the Computer's Sound box can listen on this farm${firewallNote(c)}.` };
            return { ok: false, level: 'warn', message: `Speech to text did not become ready on port ${c.stt.port} (download or load still running? see the [stt] log). Continuing without it.` };
        },
        alive: (c) => stt.sttAlive(c.stt.port, probeHost(c)),
    },
];

class FarmService {
    constructor(desc) {
        this.desc = desc;
        this.child = null;
        this.up = false;
        this.wasUp = false;     // did it ever come up healthy (gates the alive probe)
        this.ctx = {};
        this.onDown = null;     // set by up.js: fires when a running child later exits
    }
    get id() { return this.desc.id; }
    get label() { return this.desc.label; }
    get runsOn() { return this.desc.runsOn; }
    get healthKey() { return this.desc.healthKey; }
    get configKey() { return this.desc.configKey; }
    get pid() { return this.child ? this.child.pid : null; }
    enabled(config) { return this.desc.enabled(config); }
    port(config) { return this.desc.port(config); }

    // ensure install → spawn → health-wait. Returns { ok, level, message } for the caller
    // to log (or { ok:false } with no message when ensure declined — it logs its own).
    // Never throws; used by boot AND control.setPlugin.
    async start(config, runtime) {
        const log = runtime.log;
        try { this.ctx = this.desc.makeCtx ? await this.desc.makeCtx(config, runtime) : {}; }
        catch { this.ctx = {}; }
        if (this.desc.stepMessage) log.step(this.desc.stepMessage(config, this.ctx));
        let ensured = false;
        try { ensured = await this.desc.ensure(config, this.ctx); } catch { ensured = false; }
        if (!ensured) { this.up = false; return { ok: false, level: null, message: null }; }
        const child = this.desc.spawn(config, this.ctx);
        this.child = child;
        // One exit listener does double duty: flags a startup death, and (once up) fires
        // onDown so a later crash stops advertising the plugin.
        let exited = false;
        child.on('exit', () => {
            exited = true;
            if (this.child === child) {
                this.child = null;
                if (this.up) { this.up = false; if (this.onDown) this.onDown(this); }
            }
        });
        child.on('error', (e) => log.warn(`${this.label} failed to start: ${e.message}`));
        if (child.stdout) child.stdout.on('data', log.childPrefix(this.desc.logPrefix));
        if (child.stderr) child.stderr.on('data', log.childPrefix(this.desc.logPrefix));
        let res;
        try { res = await this.desc.waitReady(config, this.ctx, () => exited); }
        catch { res = { ok: false, level: 'warn', message: `${this.label} health check failed — continuing without it.` }; }
        if (exited) { this.up = false; return { ok: false, level: 'warn', message: `${this.label} exited during startup (port ${this.port(config)} already in use? see the [${this.desc.logPrefix}] log above). Continuing without it.` }; }
        this.up = !!res.ok;
        this.wasUp = this.up;
        return res;
    }

    async stop() {
        const c = this.child;
        this.child = null;      // null BEFORE kill so the exit listener doesn't fire onDown
        this.up = false;
        this.wasUp = false;
        if (c) await killTree(c.pid);
    }

    // Health-timer re-probe: only advertise while it actually answers (and it came up).
    async probe(config) {
        if (!this.child) { this.up = false; return false; }
        let alive = false;
        try { alive = await this.desc.alive(config); } catch { alive = false; }
        this.up = this.wasUp && alive;
        return this.up;
    }
}

function makeServices() { return DESCRIPTORS.map((d) => new FarmService(d)); }

// The generic plugin map advertised in the snapshot + shown in the admin page.
function pluginsSummary(services, config) {
    const out = {};
    for (const s of services) out[s.id] = { label: s.label, runsOn: s.runsOn, enabled: s.enabled(config), healthy: s.up };
    return out;
}

module.exports = { makeServices, pluginsSummary, FarmService, DESCRIPTORS };
