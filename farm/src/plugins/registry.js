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
const bus = require('../bus');
const embed = require('../embed');
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
// start/makeCtx) carries { log, pluginKey, resolveOcrModel, isLocalHost, reachable }; pluginKey(id, password)
// is identity.js's, the same bearer key on every run (a new one restarted every client's Open WebUI) until
// the farm password changes. makeCtx runs at each plugin start, so it reads the password of that start: a
// password change reaches the plugins at the next full farm restart (identity.js says what that costs).
const farmPassword = (c) => (c.proxy && c.proxy.masterKey) || null;
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
            return { key: rt.pluginKey('ocr', farmPassword(c)), model: rt.resolveOcrModel(c), ollamaUrl: localOllama.replace(/\/+$/, '') + '/api/generate' };
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
        // Ecosystem plan §8d (P3b): where boards and Computers meet — an MQTT broker, a WebSocket hub and an
        // OSC relay on one topic space (src/bus.js). Node only: nothing to install. Its own process (the
        // same child shape as the others), so a flood or a parser bug never reaches the seat gate.
        id: 'bus', label: 'Message bus (MQTT · WebSocket · OSC)', logPrefix: 'bus', configKey: 'bus', healthKey: 'busUp', runsOn: 'farm',
        // Started after the farm is public (up.js), like the Computer's other plugins, and listed before
        // them: the late ones start in this order, and the bus takes a second where their first start
        // installs for minutes.
        late: true,
        enabled: (c) => !!(c.bus && c.bus.enabled),
        port: (c) => c.bus.mqttPort,
        // The bus checks the farm password itself; up.js's health tick hands it a changed one (bus.sendKey).
        makeCtx: (c) => ({ key: (c.proxy && c.proxy.masterKey) || null }),
        ensure: async () => true,
        spawn: (c, ctx) => bus.spawnBus(c, ctx),
        stepMessage: (c) => `Message bus: MQTT ${c.bus.mqttPort} · WebSocket ${c.bus.wsPort} · OSC ${c.bus.oscPort} (udp) …`,
        waitReady: async (c, ctx, isDead) => {
            if (await bus.waitForBus(c.bus.wsPort, undefined, probeHost(c), isDead)) {
                return { ok: true, level: 'ok', message: `Message bus up — boards and Computers meet on MQTT ${c.bus.mqttPort}, WebSocket ${c.bus.wsPort} and OSC ${c.bus.oscPort}${ctx.key ? ' (with the farm password)' : ''}${firewallNote(c)}.` };
            }
            return { ok: false, level: 'warn', message: `Message bus did not start (a port already in use? see the [bus] log). Continuing without it.` };
        },
        alive: (c) => bus.busAlive(c.bus.wsPort, probeHost(c)),
    },
    {
        // Document search (owner, 2026-10-08; src/embed.js): the laptops' document text in, vectors out, nothing kept.
        // It holds GPU memory, so a boot starts it BEFORE the engine sizes its own (up.js: `early`) when everything is
        // on disk; a first download waits until the farm is public instead (`late`), like Classify's.
        id: 'embed', label: 'Document search', logPrefix: 'embed', configKey: 'embed', healthKey: 'embedUp', runsOn: 'farm',
        // llama-server writes three lines per text (its slot taking it, a token count, releasing it): 600 lines for a
        // 50-page document. The farm's log keeps its other lines (start, warnings, errors); none of them holds a text.
        logSkip: / slot +(get_availabl|launch_slot_|release): /,
        early: (c) => embed.ready(c),
        late: (c) => !embed.ready(c),
        enabled: (c) => !!(c.embed && c.embed.enabled === true),
        port: (c) => c.embed.port,
        makeCtx: (c, rt) => ({ key: rt.pluginKey('embed', farmPassword(c)) }),
        ensure: (c) => embed.ensureEmbed(c),
        spawn: (c, ctx) => embed.spawnEmbed(c, ctx),
        stepMessage: (c) => `Document search: preparing ${embed.MODEL.id} on llama-server (port ${c.embed.port}) — a first start downloads llama.cpp and the model …`,
        waitReady: async (c, ctx, isDead) => {
            const r = await embed.waitForEmbed(c.embed.port, ctx.key, probeHost(c), isDead);
            if (r.error) return { ok: false, level: 'warn', message: `Document search did not start: ${r.error}. Continuing without it.` };
            if (r.up) return { ok: true, level: 'ok', message: `Document search up (${embed.MODEL.id}, ${embed.MODEL.dims} numbers per text) — laptops index their documents here; nothing is kept${firewallNote(c)}.` };
            return { ok: false, level: 'warn', message: `Document search did not become ready on port ${c.embed.port} (see the [embed] log). Continuing without it.` };
        },
        alive: (c) => embed.embedAlive(c.embed.port, probeHost(c)),
    },
    {
        // Ecosystem plan v2 §3.2: Laya for the Computer's Classify box. CPU-first, off by default.
        id: 'classify', label: 'Classify (Laya)', logPrefix: 'classify', configKey: 'classify', healthKey: 'classifyUp', runsOn: 'farm',
        late: true,   // started after the farm is public (up.js): a first start installs ~1 GB
        enabled: (c) => !!(c.classify && c.classify.enabled),
        port: (c) => c.classify.port,
        makeCtx: (c, rt) => ({ key: rt.pluginKey('classify', farmPassword(c)) }),
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
        // Ecosystem plan v2 §3.3: speech to text for the Computer's Sound box (Listen) and Open WebUI's microphone and
        // Call mode. Off by default. On the GPU (src/stt.js) it starts before the engine sizes its memory when it is all
        // on disk, as document search; on the CPU, or with a first download ahead, once the farm is public.
        id: 'stt', label: 'Speech to text', logPrefix: 'stt', configKey: 'stt', healthKey: 'sttUp', runsOn: 'farm',
        early: (c) => stt.ready(c),
        late: (c) => !stt.ready(c),
        enabled: (c) => !!(c.stt && c.stt.enabled),
        port: (c) => c.stt.port,
        makeCtx: (c, rt) => ({ key: rt.pluginKey('stt', farmPassword(c)) }),
        ensure: (c) => stt.ensureStt(c),
        spawn: (c, ctx) => stt.spawnStt(c, ctx),
        stepMessage: (c) => `Speech to text: preparing faster-whisper "${c.stt.model}" on the ${c.stt.device === 'cuda' ? 'GPU' : 'CPU'} (port ${c.stt.port}) — first run installs it and downloads the model …`,
        waitReady: async (c, ctx, isDead) => {
            const sx = await stt.waitForStt(c.stt.port, undefined, probeHost(c), isDead);
            if (sx.error) return { ok: false, level: 'warn', message: `Speech to text could not load its model (${sx.error}). Continuing without it.` };
            ctx.model = sx.model || c.stt.model;   // what the snapshot advertises (the CPU model after a fallback)
            ctx.device = sx.device;
            const where = sx.device === 'cuda' ? 'GPU' : sx.fallback ? `CPU: the GPU did not load (${sx.fallback})` : 'CPU';
            if (sx.up) return { ok: true, level: sx.fallback ? 'warn' : 'ok', message: `Speech to text up (faster-whisper ${ctx.model}, ${where}) — Open WebUI's microphone and the Computer's Sound box transcribe on this farm${firewallNote(c)}.` };
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
    // When a boot starts it: `early` = before the engine sizes its memory, `late` = once the farm is public, neither =
    // with the others before the farm is public. A descriptor's flag may depend on the config (Document search).
    isEarly(config) { const e = this.desc.early; return typeof e === 'function' ? !!e(config) : !!e; }
    isLate(config) { const l = this.desc.late; return typeof l === 'function' ? !!l(config) : !!l; }
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
        if (child.stdout) child.stdout.on('data', log.childPrefix(this.desc.logPrefix, this.desc.logSkip));
        if (child.stderr) child.stderr.on('data', log.childPrefix(this.desc.logPrefix, this.desc.logSkip));
        let res;
        try { res = await this.desc.waitReady(config, this.ctx, () => exited); }
        catch { res = { ok: false, level: 'warn', message: `${this.label} health check failed — continuing without it.` }; }
        if (exited) { this.up = false; return { ok: false, level: 'warn', message: `${this.label} exited during startup (port ${this.port(config)} already in use? see the [${this.desc.logPrefix}] log above). Continuing without it.` }; }
        this.up = !!res.ok;
        this.wasUp = this.up;
        // Not ready (a model that failed to load, a timeout): stop it, so it gives back its port and RAM
        // instead of idling until `lol down` (release critic).
        if (!res.ok && this.child === child) {
            this.child = null;
            try { await killTree(child.pid); } catch { /* already gone */ }
        }
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
