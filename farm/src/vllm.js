// vLLM, run BY THE FARM: the fourth engine (owner, 2026-10-07; docs/VLLM_MANAGED_PLAN.md), for many people at
// once on a big NVIDIA GPU. Shaped like llamacpp.js, except that the farm drives the scripts in farm/vllm instead
// of re-implementing them: serve.sh starts (daemon mode, the relay, the CUDA shims, the memory guard, the process
// group), stop.sh stops, install.sh installs and downloads, status.sh reports. On Windows they run inside WSL2.
//
// This file holds the PURE half: what the farm decides from what status.sh printed and what the config says —
// which problems block, how much GPU memory goes to conversations, how many people fit, the exact `vllm serve`
// argv, whether a running server can be kept (adopted), what a crash means, how far a start has got, and what to
// tell the operator when it fails. Every text a person reads is plain words (the panel is for non-technical
// operators) and never names a config key. The process half (spawning the scripts) arrives with the lifecycle.

const path = require('path');
const CATALOG = require('./capacity/catalog.json');
const MEASURED = require('./capacity/measured.json');

const GIB = 2 ** 30;
const RUNTIME_GIB = 4;   // vLLM's own use beside weights and pool: production runs 74.9 GiB = 50 pool + 20.37 weights + ~1.4 desktop + ~3
const VLLM_DIR = path.join(__dirname, '..', 'vllm');
const ENV_DROP = ['ELECTRON_RUN_AS_NODE', 'LOL_PYTHON', 'PYTHONHOME', 'PYTHONPATH'];   // never into a script's environment
const UNSUPPORTED = 'Not available on this computer: vLLM needs an NVIDIA GPU on Linux, or Windows with WSL.';

const r1 = (x) => (x >= 10 ? Math.round(x) : Math.round(x * 10) / 10);   // GB as a person reads them

// ---- where it can run -------------------------------------------------------------------------------------------

function supported(platform = process.platform, arch = process.arch) {
    if (platform === 'win32') return arch === 'x64' ? { ok: true, why: null } : { ok: false, why: 'platform' };   // through WSL
    if (platform === 'linux') return ['x64', 'arm64'].includes(arch) ? { ok: true, why: null } : { ok: false, why: 'platform' };
    return { ok: false, why: platform === 'darwin' ? 'mac' : 'platform' };
}

// wsl.exe writes UTF-16LE (with or without a BOM); a WSL_UTF8=1 environment makes it UTF-8.
function decodeWsl(buf) {
    if (typeof buf === 'string') return buf;
    const b = Buffer.from(buf);
    if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
    return b.includes(0) ? b.toString('utf16le') : b.toString('utf8');
}

// `wsl.exe -l -v` → [{name, state, version, isDefault}]. The state may be localized and hold spaces.
function parseWslList(buf) {
    const out = [];
    for (const line of decodeWsl(buf).split(/\r?\n/)) {
        const m = /^\s*(\*?)\s*(\S+)\s+(.+?)\s+(\d+)\s*$/.exec(line);
        if (m) out.push({ name: m[2], state: m[3], version: Number(m[4]), isDefault: m[1] === '*' });
    }
    return out;
}

// The distribution vLLM goes into: WSL's default, unless that is Docker Desktop's own (then the first other WSL 2 one).
function defaultDistro(list) {
    const def = list.find((d) => d.isDefault);
    if (def && !/^docker-desktop/i.test(def.name)) return def.name;
    const other = list.find((d) => !/^docker-desktop/i.test(d.name) && d.version === 2);
    return other ? other.name : null;
}

// How the farm runs one of the scripts: on Windows through wsl.exe from the Windows path of farm/vllm, on Linux
// with bash from that folder. `env` reaches the script; the farm's own Electron and Python variables never do.
function scriptCommand(config, script, env = {}, { platform = process.platform, distro = config.vllm.distro, dir = VLLM_DIR, args = [], baseEnv = process.env } = {}) {
    const clean = { ...baseEnv };
    for (const k of ENV_DROP) delete clean[k];
    if (platform === 'win32') {
        return {
            cmd: 'wsl.exe',
            args: [...(distro ? ['-d', distro] : []), '--cd', dir, '-e', 'env', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), 'bash', `./${script}`, ...args],
            cwd: undefined,
            env: clean,
        };
    }
    return { cmd: 'bash', args: [`./${script}`, ...args], cwd: dir, env: { ...clean, ...env } };
}

// ---- what status.sh printed ---------------------------------------------------------------------------------------

function parseStatus(text) {
    const out = {
        home: null, arch: null, root: null, distro: null, uv: null, curl: null, gpu: null,
        memTotalGib: null, memAvailableGib: null, diskFreeGb: null,
        installs: [], models: [], running: null, found: [], guardLine: null, installing: null, managed: false,
    };
    const env = {}; const argv = []; const links = new Set(); let ready = false;
    const num = (s) => (/^\d+(\.\d+)?$/.test(String(s).trim()) ? Number(s) : null);
    for (const line of String(text || '').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i < 1) continue;
        const k = line.slice(0, i); const v = line.slice(i + 1);
        switch (k) {
        case 'home': case 'arch': case 'root': case 'distro': case 'uv': case 'curl': out[k] = v || null; break;
        case 'gpu': {   // name, MiB total, MiB free, compute capability ([N/A] where the GPU shares the system memory)
            const p = v.split(','); const cap = p.pop(); const free = p.pop(); const total = p.pop();
            out.gpu = { name: p.join(',').trim(), totalGib: num(total) != null ? num(total) / 1024 : null, freeGib: num(free) != null ? num(free) / 1024 : null, cap: num(cap) };
            break;
        }
        case 'mem_total_kb': out.memTotalGib = Number(v) / 1048576; break;
        case 'mem_available_kb': out.memAvailableGib = Number(v) / 1048576; break;
        case 'disk_free_kb': out.diskFreeGb = Number(v) * 1024 / 1e9; break;
        case 'install': { const [root, version] = v.split(' '); out.installs.push({ root, version: version || null, link: false }); break; }
        case 'venv_link': links.add(v); break;
        case 'model': {
            const m = /^(\S+) (\d+) vision=([01]) native=(\d*) partial=([01])$/.exec(v);
            if (m) out.models.push({ folder: m[1], gb: Number(m[2]) * 1024 / 1e9, vision: m[3] === '1', native: m[4] ? Number(m[4]) : null, partial: m[5] === '1' });
            break;
        }
        case 'running': out.running = { pgid: Number(v) }; break;
        case 'env': { const j = v.indexOf('='); if (j > 0) env[v.slice(0, j)] = v.slice(j + 1); break; }
        case 'arg': argv.push(v); break;
        case 'ready': ready = v === '1'; break;
        case 'found': { const [root, port, pgid] = v.split(' '); out.found.push({ root, port: Number(port), pgid: Number(pgid) }); break; }
        case 'guard': out.guardLine = v; break;
        case 'installing': out.installing = Number(v); break;
        case 'managed': out.managed = v === '1'; break;
        default: break;
        }
    }
    for (const inst of out.installs) inst.link = links.has(inst.root);
    if (out.running) {
        Object.assign(out.running, {
            port: Number(env.LOL_VLLM_PORT) || 8100,
            minFreeGb: env.LOL_VLLM_MIN_FREE_GB ? Number(env.LOL_VLLM_MIN_FREE_GB) : null,
            managedArgs: env.LOL_VLLM_ARGS_B64 ? Buffer.from(env.LOL_VLLM_ARGS_B64, 'base64').toString('utf8').split('\0') : null,
            argv,
            ready,
        });
    }
    return out;
}

// The memory vLLM sizes against: the GPU's own, or the system's where the GPU shares it (DGX Spark: nvidia-smi
// reports no memory of its own).
function memOf(st) {
    const g = st && st.gpu;
    if (g && g.totalGib != null && g.freeGib != null) return { unified: false, totalGib: g.totalGib, freeGib: g.freeGib, memAvailableGib: null };
    return { unified: true, totalGib: st ? st.memTotalGib : null, freeGib: null, memAvailableGib: st ? st.memAvailableGib : null };
}

// ---- the model -----------------------------------------------------------------------------------------------------

function vllmEntry(config) {
    const v = config.vllm || {};
    return (v.library || []).find((e) => e.id === v.model) || null;
}

const folderOf = (entry) => (entry ? entry.folder || (entry.repo ? entry.repo.split('/').pop() : entry.id) : null);

function rootPath(p, home) { return home && p.startsWith('~') ? home + p.slice(1) : p; }

// Where vLLM lives: the configured root; else the first install found in ~/lol-vllm, then ~/lol-spike (where this
// project's spike installed it); else ~/lol-vllm.
function resolveRoot(config, st) {
    const home = st && st.home;
    if (config.vllm.root) return rootPath(config.vllm.root, home);
    for (const c of ['~/lol-vllm', '~/lol-spike']) {
        if (st && st.installs.some((i) => i.root === rootPath(c, home))) return rootPath(c, home);
    }
    return rootPath('~/lol-vllm', home);
}

// The memory one person's conversation takes, from src/capacity/catalog.json: the context memory per token (twice
// the fp8 figure when the model's flags keep the context in 16 bits), and what vLLM charges each request for the
// model's recurrent state.
function facts(entry) {
    const m = entry && entry.catalog && CATALOG.models.find((x) => x.id === entry.catalog);
    if (!m || !m.kv_bytes_per_token_fp8) return { kvBytesPerToken: null, stateBytes: null, nativeCtx: m ? m.context_native ?? null : null };
    const fp8 = /^fp8/.test(String(flagMap(entry.args || [])['--kv-cache-dtype'] || ''));
    return {
        kvBytesPerToken: m.kv_bytes_per_token_fp8 * (fp8 ? 1 : 2),
        stateBytes: m.vllm_state_charge_bytes ?? 2 * (m.recurrent_state_bytes || 0),
        nativeCtx: m.context_native ?? null,
    };
}

const personBytes = (ctx, f) => (f && f.kvBytesPerToken ? ctx * f.kvBytesPerToken + (f.stateBytes || 0) : null);

// How many people's full conversations the pool holds, or null when the model's memory per person is unknown.
function peopleFit(poolGib, ctx, f) {
    const p = personBytes(ctx, f);
    return p && poolGib != null ? Math.floor(poolGib * GIB / p) : null;
}

const BOXES = [[/RTX PRO 6000 Blackwell(?!.*Max-Q)/i, 'pro6000'], [/GB10/i, 'spark']];
const boxOf = (gpuName) => { const b = BOXES.find(([rx]) => rx.test(gpuName || '')); return b ? b[1] : null; };

// What src/capacity/measured.json measured for this model on this card: people at once per context, when everyone
// writes at once ('every') and in normal use ('steady'), as its labels ("48", "≥ 64", "< 8").
function measuredFor(entry, gpuName) {
    const box = boxOf(gpuName);
    const c = box && entry && entry.measured && MEASURED.configs.find((x) => x.id === `${box}/vllm/${entry.measured}`);
    if (!c) return null;
    const at = {};
    for (const [k, v] of Object.entries(c.people || {})) {
        const m = /^followup_(\d+)k$/.exec(k);
        if (m) at[Number(m[1]) * 1024] = { every: v.every ? v.every.label : null, steady: v.steady ? v.steady.label : null };
    }
    return { box, at };
}

function labelSeats(label) {
    const m = /^(≥|<)?\s*(\d+)$/.exec(String(label == null ? '' : label).trim());
    if (!m) return null;
    const n = Number(m[2]);
    return m[1] === '<' ? Math.max(1, Math.floor(n / 2)) : Math.max(1, n);
}

// People at once when the operator leaves it on Automatic: what was measured on this card with this model at this
// context (or the nearest measured context above), never more than the pool holds; else what the pool holds, at
// most 16; else 4 to start with.
function seatsAuto(entry, gpuName, ctx, fit) {
    const meas = measuredFor(entry, gpuName);
    const key = meas && Object.keys(meas.at).map(Number).sort((a, b) => a - b).find((c) => c >= ctx);
    const label = key ? meas.at[key].every : null;
    const n = labelSeats(label);
    if (n != null) return fit != null && fit < n ? { seats: Math.max(1, fit), source: 'memory', label } : { seats: n, source: 'measured', label };
    if (fit != null) return { seats: Math.max(1, Math.min(16, fit)), source: 'memory', label: null };
    return { seats: 4, source: 'default', label: null };
}

// vLLM's own cap on requests at once: twice the seats (a person's reply and the title or search query beside it),
// as a power of 2, at least 32 and at most 512. 48 → 128, 8 → 32, 96 → 256.
function maxNumSeqsAuto(seats) {
    return Math.min(512, Math.max(32, 2 ** Math.ceil(Math.log2(Math.max(1, 2 * seats)))));
}

// GPU memory for conversations, in whole GiB: what is free now, less a margin, the model, vLLM's runtime and the
// share kept for document reading (Ollama's OCR model); on unified memory, from what the system has available, less
// the memory guard's floor too. `cap` (GiB) keeps a small model from taking the whole card. `personGib` = one
// person's conversation at the chosen context, when known.
function poolGib({ totalGib, freeGib, unified = false, memAvailableGib = null, weightsGib = 0, ocrReserveGib = 0, marginPct = 8, minFreeGb = 0, cap = null, personGib = null }) {
    const marginGib = (marginPct / 100) * (totalGib || 0);
    const base = unified ? memAvailableGib : freeGib;
    const raw = (base || 0) - marginGib - (unified ? minFreeGb || 0 : 0) - weightsGib - RUNTIME_GIB - ocrReserveGib;
    let gib = Math.floor(raw);
    const capped = cap != null && gib > cap;
    if (capped) gib = cap;
    const why = { freeGib: base, weightsGib, ocrReserveGib, marginGib, runtimeGib: RUNTIME_GIB, minFreeGb: unified ? minFreeGb || 0 : 0, unified, capped };
    const ok = gib >= 1 && (personGib == null || gib >= personGib);
    if (ok) return { gib, why, ok, reason: null };
    const where = unified ? `This computer has ${r1(base || 0)} GB of memory available` : `The GPU has ${r1(base || 0)} GB free`;
    const after = `the model (${r1(weightsGib)} GB)${ocrReserveGib ? `, document reading (${r1(ocrReserveGib)} GB)` : ''}${unified && minFreeGb ? `, the ${minFreeGb} GB kept so the computer cannot run out` : ''} and a safety margin`;
    const need = personGib != null ? `less than one person's conversation needs (${r1(personGib)} GB)` : 'not enough for anyone';
    return {
        gib: Math.max(0, gib), why, ok,
        reason: `${where}. After ${after}, ${Math.max(0, gib)} GB are left for conversations: ${need}. Close what else uses the ${unified ? 'memory' : 'GPU'}, or lower the context per person.`,
    };
}

// ---- the launch ------------------------------------------------------------------------------------------------------

// What a start is launched WITH, as the operator set it ('auto' stays 'auto'): adoption and Apply compare these,
// never numbers worked out again (D9).
function settingsOf(config, root = config.vllm.root) {
    const v = config.vllm; const e = vllmEntry(config);
    return {
        modelId: v.model,
        modelPath: root && e ? `${root}/hf/${folderOf(e)}` : null,
        ctx: v.contextLength,
        seats: v.parallel,
        maxNumSeqs: v.maxNumSeqs,
        kvCacheGib: v.kvCacheGib,
        maxReply: config.proxy.maxReplyTokens ?? null,
        extraArgs: v.extraArgs || [],
        port: v.port,
        minFreeGb: v.minFreeGb,
    };
}

// The whole `vllm serve` argv after the model (serve.sh adds --uds). The farm owns all of it, as llamacpp.js owns
// llama-server's.
function argvFor(entry, s, kvGib, maxNumSeqs) {
    return [
        '--served-model-name', s.modelId,
        '--max-model-len', String(s.ctx),
        '--max-num-seqs', String(maxNumSeqs),
        '--kv-cache-memory-bytes', String(Math.round(kvGib * GIB)),
        ...(entry.args || []),
        ...(s.maxReply ? ['--override-generation-config', JSON.stringify({ max_new_tokens: s.maxReply })] : []),
        ...s.extraArgs,
    ];
}

const minFreeOf = (v, unified) => (v === 'auto' ? (unified ? 8 : null) : v || null);

// Everything a start needs, or why it cannot start. `st` = parseStatus; `mem` = memOf(st) measured just before the
// start (after Ollama's models were evicted).
function planFor(config, st, mem = memOf(st), { ocrEnabled = !!(config.ocr && config.ocr.enabled) } = {}) {
    const v = config.vllm; const entry = vllmEntry(config);
    if (!entry) return { ok: false, reason: `The model "${v.model}" is not in the vLLM list: pick one there.`, entry: null };
    const root = resolveRoot(config, st);
    const folderPath = `${root}/hf/${folderOf(entry)}`;
    const s = settingsOf(config, root);
    const f = facts(entry);
    const onDisk = st && st.models.find((m) => m.folder === folderOf(entry));
    const weightsGib = entry.weightsGib ?? (onDisk ? onDisk.gb * 1e9 / GIB : (entry.sizeGb || 0) * 1e9 / GIB);
    const pb = personBytes(s.ctx, f);
    const minFreeGb = minFreeOf(v.minFreeGb, mem.unified);
    const poolIn = {
        totalGib: mem.totalGib, freeGib: mem.freeGib, unified: mem.unified, memAvailableGib: mem.memAvailableGib, weightsGib,
        ocrReserveGib: ocrEnabled ? v.ocrReserveGib : 0, marginPct: v.marginPct, minFreeGb: minFreeGb || 0, personGib: pb ? pb / GIB : null,
    };
    const autoKv = v.kvCacheGib === 'auto';
    // The seats need a pool to count people in; the pool's cap needs the seats: uncapped first, then capped.
    const pool0 = autoKv ? poolGib(poolIn) : null;
    const auto = v.parallel === 'auto' ? seatsAuto(entry, st && st.gpu ? st.gpu.name : null, s.ctx, peopleFit(autoKv ? pool0.gib : v.kvCacheGib, s.ctx, f)) : null;
    const seats = auto ? auto.seats : v.parallel;
    const maxNumSeqs = v.maxNumSeqs === 'auto' ? maxNumSeqsAuto(seats) : v.maxNumSeqs;
    let kvGib = v.kvCacheGib; let kvWhy = null;
    if (autoKv) {
        const p = poolGib({ ...poolIn, cap: pb ? Math.ceil(maxNumSeqs * pb * 1.1 / GIB) : null });
        if (!p.ok) return { ok: false, reason: p.reason, entry };
        kvGib = p.gib; kvWhy = p.why;
    } else if (pb && kvGib * GIB < pb) {
        return { ok: false, reason: `${kvGib} GB of GPU memory for conversations is less than one person's conversation needs at this context (${r1(pb / GIB)} GB): give vLLM more, or lower the context per person.`, entry };
    }
    const argv = argvFor(entry, s, kvGib, maxNumSeqs);
    const env = {
        LOL_VLLM_DAEMON: '1',
        LOL_VLLM_ROOT: root,
        LOL_VLLM_PORT: String(v.port),
        LOL_VLLM_MODEL: folderPath,
        LOL_VLLM_ARGS_B64: Buffer.from(argv.join('\0'), 'utf8').toString('base64'),
        ...(minFreeGb ? { LOL_VLLM_MIN_FREE_GB: String(minFreeGb) } : {}),
        ...(mem.unified ? { MAX_JOBS: '4' } : {}),   // a first start compiles kernels; one job per core ran a Spark out of memory
    };
    return {
        ok: true, reason: null, entry, root, port: v.port, folderPath, seats, seatsSource: auto ? auto.source : 'set',
        maxNumSeqs, kvGib, kvWhy, minFreeGb, env, argv, peopleFit: peopleFit(kvGib, s.ctx, f), settings: s,
    };
}

// `vllm serve` flags as a map, so two launches compare whatever their order: --uds dropped (serve.sh adds it), a
// repeated flag keeps its last value (as vLLM does), a flag with no value is true, and the generation override is
// compared as JSON.
function flagMap(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        let a = String(argv[i]);
        if (!a.startsWith('--')) continue;   // the model, which comes first
        let val;
        const eq = a.indexOf('=');
        if (eq > 0) { val = a.slice(eq + 1); a = a.slice(0, eq); }
        else if (i + 1 < argv.length && !String(argv[i + 1]).startsWith('--')) val = String(argv[++i]);
        else val = true;
        if (a === '--uds') continue;
        if (a === '--override-generation-config' && typeof val === 'string') { try { val = JSON.parse(val); } catch { /* compared as text */ } }
        out[a] = val;
    }
    return out;
}

const stable = (x) => (x && typeof x === 'object' ? JSON.stringify(Object.keys(x).sort().reduce((o, k) => ((o[k] = x[k]), o), {})) : JSON.stringify(x));

// Can the farm keep a server that already runs (after a farm crash, or one an operator started)? It compares
// SETTINGS (D9): an explicit setting must equal what the server runs with; an Automatic one accepts the running
// value — the GPU memory it holds is not free to be measured again. `running` = parseStatus's.
function adoptable(config, running, { unified = false, gpuName = null, root = config.vllm.root } = {}) {
    const v = config.vllm; const entry = vllmEntry(config);
    if (!entry || !running || !running.argv || !running.argv.length) return { ok: false, resolved: null, diff: ['model'] };
    const s = settingsOf(config, root);
    const have = flagMap(running.argv.slice(1));
    const diff = [];
    if (running.argv[0] !== s.modelPath) diff.push('model');
    if (running.port !== v.port) diff.push('port');
    const kvGib = v.kvCacheGib === 'auto' ? Number(have['--kv-cache-memory-bytes']) / GIB : v.kvCacheGib;
    const seats = v.parallel === 'auto' ? seatsAuto(entry, gpuName, s.ctx, peopleFit(kvGib, s.ctx, facts(entry))).seats : v.parallel;
    const maxNumSeqs = v.maxNumSeqs === 'auto' ? maxNumSeqsAuto(seats) : v.maxNumSeqs;
    const want = flagMap(argvFor(entry, s, kvGib, maxNumSeqs));
    for (const k of new Set([...Object.keys(want), ...Object.keys(have)])) if (stable(want[k]) !== stable(have[k])) diff.push(k);
    if ((running.minFreeGb ?? null) !== minFreeOf(v.minFreeGb, unified)) diff.push('minFreeGb');
    return { ok: diff.length === 0, resolved: { kvGib, maxNumSeqs, seats }, diff };
}

// ---- what to do ----------------------------------------------------------------------------------------------------

// At boot, with vLLM the engine: serve with the running server at once, wait for one that is starting, restart one
// launched otherwise, or start one.
function bootDecision({ supported: sup = { ok: true }, problems = [], running = null, adopt = null }) {
    if (!sup.ok) return { action: 'unavailable', reason: UNSUPPORTED };
    if (problems.length) return { action: 'unavailable', reason: problems[0] };
    if (running && adopt && adopt.ok) return { action: running.ready ? 'adopt' : 'wait', reason: null };
    return { action: running ? 'restart' : 'start', reason: null };
}

// vLLM stopped answering. The memory guard's stop is never undone; a slow server that still answers is fine; a
// socket that answers behind a dead port means the relay died (restart); a second restart within 5 minutes falls
// back to Ollama.
function downDecision({ guard = false, running = false, ready = false, portAnswers = false, lastRestartAt = null, now = Date.now() }) {
    if (guard) return 'guard';
    if (running && ready && portAnswers) return 'none';
    if (lastRestartAt != null && now - lastRestartAt < 5 * 60e3) return 'fallback';
    return 'restart';
}

// A vLLM the farm started (its marker is there) that still runs while another engine serves: left by a crash in
// the middle of a switch. Stop it. One without the marker belongs to someone else and is left alone.
function isOrphan(engine, st) {
    return engine !== 'vllm' && !!(st && st.running && st.managed);
}

// ---- reading vLLM's log --------------------------------------------------------------------------------------------

const PHASES = {
    starting: 'starting vLLM',
    reading: 'reading the model',
    weights: 'loading the model weights',
    kernels: 'preparing the GPU (the first start takes a few minutes longer)',
    graphs: 'capturing GPU graphs',
    almost: 'almost ready',
    ready: 'ready',
    exited: 'stopped',
};
const RANK = Object.keys(PHASES);

// How far a start has got, from the log lines written since it began; pass the last result as `prev` to read on.
// vLLM writes its progress bars as \r-separated updates inside one line, hence the split on \r too. Phases only
// move forward, so a late line of an earlier kind does not take the panel back.
function startPhase(text, prev = null) {
    const fresh = () => ({ key: null, text: null, percent: null, weightsGib: null, poolTokens: null, peopleFit: null, status: null });
    let s = prev ? { ...prev } : fresh();
    const to = (key, extra = {}) => {
        if (RANK.indexOf(key) < RANK.indexOf(s.key)) return;
        s.key = key; s.text = extra.text || PHASES[key]; s.percent = extra.percent ?? null;
    };
    for (const line of String(text || '').split(/\r\n|\r|\n/)) {
        let m;
        if (/^\[serve\] .*\bpgid=\d+/.test(line)) { s = fresh(); to('starting'); }
        else if ((m = /^\[serve\] .*vLLM exited \(status (\d+)\)/.exec(line))) { s.status = Number(m[1]); to('exited'); }
        else if (/^\[serve\] .* ready: /.test(line)) to('ready');
        else if (/init engine/.test(line)) to('almost');
        else if (/Capturing CUDA graphs/.test(line)) to('graphs');
        else if ((m = /GPU KV cache size: ([\d,]+) tokens.*Maximum concurrency for [\d,]+ tokens per request: ([\d.]+)x/.exec(line))) {
            s.poolTokens = Number(m[1].replace(/,/g, '')); s.peopleFit = Math.floor(Number(m[2]));
        } else if ((m = /Model loading took ([\d.]+) GiB/.exec(line))) s.weightsGib = Number(m[1]);
        else if ((m = /Loading safetensors checkpoint shards:\s*(\d+)% Completed \| (\d+)\/(\d+)/.exec(line))) {
            to('weights', { percent: Number(m[1]), text: `loading the model weights (${m[2]} of ${m[3]})` });
        } else if (/torch\.compile|Compiling|flashinfer\.jit|JIT kernel|Autotuning|autotune with/i.test(line)) to('kernels');   // not the engine's config dump (enable_flashinfer_autotune=)
        else if (/Resolved architecture|Using max model len/.test(line)) to('reading');
    }
    return s;
}

// Where to read the log from next: serve.sh moves a log over 50 MB aside at a start, so a file now smaller than
// the saved offset is a new one, read from its start.
function logOffset(size, offset) { return size < offset ? 0 : offset; }

// What to tell the operator when a start fails. `code` = serve.sh's exit status, or 'stall' / 'cap' when the farm
// gave up waiting; `lines` = the log since the start; ctx = {root, port, label, otherGpuGb}.
function explainFailure(code, lines, ctx = {}) {
    const text = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
    const has = (rx) => rx.test(text);
    if (code === 3 || /\[guard\]/.test(text)) {
        const g = /(\d+) GB of memory available, under LOL_VLLM_MIN_FREE_GB=(\d+)/.exec(text);
        return `vLLM was stopped because this computer was running out of memory${g ? ` (${g[1]} GB left; it stops below ${g[2]} GB, before the GPU gets stuck at a slow speed)` : ''}. Close what is using the memory, then press Start vLLM.`;
    }
    if (code === 'stall') return 'vLLM stopped making progress for 10 minutes. Show the log for details.';
    if (code === 'cap') return 'vLLM was still not ready after 30 minutes. Show the log for details.';
    if (has(/is already running/)) return `A vLLM from ${ctx.root || 'this folder'} is already running but does not answer. Press Stop vLLM, then Start vLLM.`;
    if (has(/relay could not listen/)) return `Another program uses port ${ctx.port || 'the port vLLM needs'}, maybe a vLLM started outside the farm. Stop it, then press Start vLLM.`;
    if (has(/No vLLM in/)) return `vLLM is not installed in ${ctx.root || 'its folder'}. Press Install vLLM.`;
    if (has(/CUDA out of memory|OutOfMemoryError|No available memory for the cache blocks/)) {
        return `vLLM ran out of GPU memory while starting. Lower GPU memory for conversations or the context, or close other programs using the GPU${ctx.otherGpuGb != null ? ` (they use ${r1(ctx.otherGpuGb)} GB now)` : ''}.`;
    }
    if (has(/not a supported model architecture|failed to be inspected/)) return `This vLLM version cannot load ${ctx.label || 'this model'}. Pick another model.`;
    const last = text.split(/\r\n|\r|\n/).reverse().find((l) => /\bERROR\b|\w(Error|Exception)\b:/.test(l));
    if (!last) return `vLLM stopped while starting${typeof code === 'number' ? ` (status ${code})` : ''}. Show the log for details.`;
    const clean = last.replace(/^\(\w+ pid=\d+\)\s*/, '').replace(/^ERROR \d\d-\d\d [\d:]+ \[[^\]]*\]\s*/, '').trim().slice(0, 300);
    return `vLLM stopped while starting. Its last error: ${clean}`;
}

// ---- what blocks it on this computer -------------------------------------------------------------------------------

// The checklist the panel shows: `oks` (done), `problems` (each blocks a start) and `warnings` (said, not blocking).
// `probe` = {platform, arch, wsl: {list} | {error: 'no-wsl'|'no-distro'|'timeout'}, distro, st (parseStatus) | null,
// stError, hostDiskFreeGb, hostDrive}; `entry` = the model to check (the selected one by default).
function problemsFrom(probe, config, entry = vllmEntry(config)) {
    const oks = []; const problems = []; const warnings = [];
    const done = () => ({ oks, problems, warnings });
    const sup = supported(probe.platform, probe.arch);
    if (!sup.ok) { problems.push(UNSUPPORTED); return done(); }
    const win = probe.platform === 'win32';
    const timeout = 'WSL did not answer within a minute. Restart the computer, then press Check again.';
    let distro = null;
    if (win) {
        const w = probe.wsl || {};
        if (w.error === 'no-wsl') {
            problems.push('WSL is not installed. vLLM runs on Linux; on Windows it runs inside WSL, which an administrator installs once. Open PowerShell as administrator, run  wsl --install -d Ubuntu , and restart the computer. Then open Ubuntu from the Start menu once, to choose a user name and password, and press Check again.');
            return done();
        }
        if (w.error === 'timeout') { problems.push(timeout); return done(); }
        const list = w.list || [];
        distro = probe.distro || config.vllm.distro || defaultDistro(list);
        const d = list.find((x) => x.name === distro);
        if (w.error === 'no-distro' || !d) {
            problems.push('WSL has no Ubuntu yet. In PowerShell, run  wsl --install -d Ubuntu , then open Ubuntu from the Start menu once to choose a user name and password, and press Check again.');
            return done();
        }
        if (d.version !== 2) {
            problems.push(`${distro} runs on WSL 1, which cannot use the GPU. In PowerShell, run  wsl --set-version ${distro} 2  (a few minutes), then press Check again.`);
            return done();
        }
        oks.push(`WSL is installed, with ${distro} on WSL 2.`);
    }
    const st = probe.st;
    if (!st) { problems.push(win ? timeout : `This computer did not answer the check${probe.stError ? ` (${probe.stError})` : ''}. Press Check again.`); return done(); }
    if (!['x86_64', 'aarch64'].includes(st.arch)) { problems.push('vLLM needs a 64-bit Intel, AMD or ARM processor.'); return done(); }
    if (!st.gpu) {
        problems.push(win
            ? `${distro} cannot see the GPU. Install the latest NVIDIA driver for Windows (it also serves WSL), restart the computer, then press Check again.`
            : 'No NVIDIA GPU was found (nvidia-smi does not answer). vLLM needs an NVIDIA GPU and its driver.');
        return done();
    }
    const mem = memOf(st);
    const gpuGb = r1(mem.totalGib || 0);
    oks.push(win ? `${distro} sees the GPU: ${st.gpu.name} (${gpuGb} GB).`
        : mem.unified ? `GPU: ${st.gpu.name} (${gpuGb} GB shared with the system).` : `GPU: ${st.gpu.name} (${gpuGb} GB).`);
    const lib = config.vllm.library || [];
    const weights = (e) => e.weightsGib ?? (e.sizeGb || 0) * 1e9 / GIB;
    const smallest = lib.length ? Math.min(...lib.map(weights)) + RUNTIME_GIB + 2 : 0;
    if (lib.length && (mem.totalGib || 0) < smallest) {
        problems.push(`This GPU has ${gpuGb} GB: too little for any model in the vLLM list (the smallest needs about ${r1(smallest)} GB). llama.cpp is the engine for this card.`);
    }
    if (st.gpu.cap != null && st.gpu.cap < 12) {
        warnings.push('This GPU is older than the cards these models were measured on (RTX PRO 6000, DGX Spark): they may not load. If a start fails, llama.cpp is the engine for this card.');
    }
    if (!st.curl) problems.push('curl is missing. In a terminal, run  sudo apt install curl , then press Check again.');
    const root = resolveRoot(config, st);
    const inst = st.installs.find((i) => i.root === root);
    if (inst) {
        oks.push(config.vllm.root ? `vLLM ${inst.version} is installed (in ${root}).` : `Found an existing vLLM in ${root}: the farm will use it.`);
        if (inst.version !== config.vllm.version) warnings.push(`vLLM ${inst.version} is installed; this farm was tested with ${config.vllm.version}.`);
    } else {
        problems.push('vLLM is not installed on this computer yet: press Install vLLM.');
    }
    if (st.installing) problems.push('A download started earlier is still running. Wait for it, or stop it here.');
    const label = entry ? entry.label : config.vllm.model;
    const m = entry && st.models.find((x) => x.folder === folderOf(entry));
    if (!entry) problems.push(`The model "${config.vllm.model}" is not in the vLLM list: pick one there.`);
    else if (!m) problems.push(`${label} is not downloaded yet: press Download next to it.`);
    else if (m.partial) problems.push(`${label} is only partly downloaded: press Download to finish it.`);
    // Disk: about 10 GB for vLLM itself, plus what is left of the model; on Windows the smaller of WSL's own disk
    // (a virtual disk that reports up to 1 TB) and the Windows drive that holds it.
    const need = (inst ? 0 : 10) + (entry && !(m && !m.partial) ? Math.max(0, (entry.sizeGb || 0) - (m ? m.gb : 0)) : 0);
    const free = Math.min(st.diskFreeGb ?? Infinity, probe.hostDiskFreeGb ?? Infinity);
    if (need > 0 && free < need) {
        problems.push(`Not enough free disk: ${inst ? `${label} needs` : `vLLM and ${label} need`} about ${r1(need)} GB, and ${r1(free)} GB are free.${win && probe.hostDrive ? ` ${distro}'s disk lives on drive ${probe.hostDrive}:.` : ''} Free some space, then press Check again.`);
    } else if (Number.isFinite(free)) {
        oks.push(`${r1(free)} GB free for vLLM and its models.`);
    }
    return done();
}

function baseUrl(config) { return `http://127.0.0.1:${config.vllm.port}/v1`; }

module.exports = {
    GIB, VLLM_DIR, UNSUPPORTED,
    supported, decodeWsl, parseWslList, defaultDistro, scriptCommand,
    parseStatus, memOf, vllmEntry, folderOf, resolveRoot, facts, peopleFit, measuredFor, seatsAuto, maxNumSeqsAuto, poolGib,
    settingsOf, argvFor, planFor, flagMap, adoptable,
    bootDecision, downDecision, isOrphan, startPhase, logOffset, explainFailure, problemsFrom, baseUrl,
};
