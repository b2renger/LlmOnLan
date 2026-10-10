// vLLM, run BY THE FARM: the fourth engine (owner, 2026-10-07; docs/VLLM_MANAGED_PLAN.md), for many people at
// once on a big NVIDIA GPU. Shaped like llamacpp.js, except that the farm drives the scripts in farm/vllm instead
// of re-implementing them: serve.sh starts (daemon mode, the relay, the CUDA shims, the memory guard, the process
// group), stop.sh stops, install.sh installs and downloads, status.sh reports. On Windows they run inside WSL2.
//
// The PURE half comes first: what the farm decides from what status.sh printed and what the config says —
// which problems block, how much GPU memory goes to conversations, how many people fit, the exact `vllm serve`
// argv, whether a running server can be kept (adopted), what a crash means, how far a start has got, and what to
// tell the operator when it fails. The PROCESS half follows (running the scripts: the check, start, wait, stop,
// the log, install); up.js holds the lifecycle that drives it. Every text a person reads is plain words (the
// panel is for non-technical operators) and never names a config key.

const fs = require('fs');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const path = require('path');
const CATALOG = require('./capacity/catalog.json');
const MEASURED = require('./capacity/measured.json');
const { VLLM_LIBRARY, ConfigSchema } = require('./config');
const { RESERVE_GIB: EMBED_RESERVE_GIB } = require('./embed');

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
        home: null, arch: null, root: null, distro: null, uv: null, curl: null, cc: null, gpu: null,
        memTotalGib: null, memAvailableGib: null, diskFreeGb: null,
        installs: [], models: [], running: null, found: [], guardLine: null, installing: null, managed: false,
    };
    const env = {}; const argv = []; const links = new Set(); const sound = new Set(); let ready = false;
    const num = (s) => (/^\d+(\.\d+)?$/.test(String(s).trim()) ? Number(s) : null);
    for (const line of String(text || '').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i < 1) continue;
        const k = line.slice(0, i); const v = line.slice(i + 1);
        switch (k) {
        case 'home': case 'arch': case 'root': case 'distro': case 'uv': case 'curl': case 'cc': out[k] = v || null; break;
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
        case 'audio': sound.add(v); break;
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
    for (const inst of out.installs) { inst.link = links.has(inst.root); inst.audio = sound.has(inst.root); }
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

// ---- the model list: a model the operator adds (§4.4) -----------------------------------------------------------

// The `vllm serve` flags a model the operator adds gets, by its family, matched on its repo or folder name: the
// measured models' own flags for their families (the default list's), a generic Qwen3 set, else prefix caching only.
// ponytail: a family this table does not know gets no thinking or tool parser, and the panel says so; the upgrade
// path is per-entry args.
// A message limit (--limit-mm-per-prompt) for a sound the model cannot hear (a Gemma 4 31B) is ignored by vLLM.
const argsOf = (id) => [...VLLM_LIBRARY.find((e) => e.id === id).args];
const FAMILY_ARGS = [
    [/qwen3-?omni/i, () => argsOf('qwen3-omni-30b-a3b')],
    [/qwen3\.[56]|qwen3-?next/i, () => argsOf('qwen3.6-35b-a3b')],
    [/qwen3\.8/i, () => argsOf('qwen3.8-27b-nvfp4')],
    [/nemotron/i, () => argsOf('nemotron-3.5-lightning')],
    [/gemma-?4/i, () => argsOf('gemma-4-12b')],
    [/qwen3/i, () => ['--enable-prefix-caching', '--reasoning-parser', 'qwen3', '--enable-auto-tool-choice', '--tool-call-parser', 'hermes']],
];
function familyArgs(name) {
    const f = FAMILY_ARGS.find(([rx]) => rx.test(String(name || '')));
    return f ? f[1]() : ['--enable-prefix-caching'];
}
// A model with neither a thinking nor a tool parser: answers work, tools and thinking may not show (the panel's note).
// Qwen3-Omni's Instruct does not think: its tool parser is enough.
const isGeneric = (entry) => !(entry.args || []).some((a) => a === '--reasoning-parser' || a === '--tool-call-parser');

// "owner/name", or a Hugging Face link to it (https://huggingface.co/owner/name, and anything after) → the repo, or
// null.
function repoOf(input) {
    const m = /^(?:https?:\/\/(?:www\.)?huggingface\.co\/)?([A-Za-z0-9][\w.-]*\/[\w.-]+?)(?:\.git)?(?:[/?#].*)?$/.exec(String(input || '').trim());
    return m ? m[1] : null;
}

// A new entry of the list, from {repo} (a name or a link) or {folder} (a folder already in <root>/hf, `disk` =
// parseStatus's models), with an optional label. Adding only remembers it: nothing downloads. → {entry} | {error}.
function newLibraryEntry(input = {}, library = [], disk = []) {
    const ids = new Set(library.map((e) => e.id));
    const idFor = (name) => {
        const base = String(name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+|-+$/g, '').slice(0, 60) || 'model';
        let id = base; let n = 2;
        while (ids.has(id)) id = `${base}-${n++}`;
        return id;
    };
    const label = (fallback) => String(input.label || fallback).replace(/[\r\n\t]/g, ' ').trim().slice(0, 80) || fallback;
    const blank = { repo: null, folder: null, sizeGb: null, weightsGib: null, vision: null, presencePenalty: null, catalog: null, measured: null, note: '' };
    if (input.folder != null) {
        const folder = String(input.folder).trim();
        if (!FOLDER_RX.test(folder) || /^\.+$/.test(folder)) return { error: 'That is not a model folder.' };
        if (library.some((e) => folderOf(e) === folder)) return { error: `${folder} is already in the list.` };
        const m = disk.find((x) => x.folder === folder);
        return { entry: { ...blank, id: idFor(folder), label: label(folder), folder, sizeGb: m ? r1(m.gb) : null, vision: m ? !!m.vision : null, args: familyArgs(folder) } };
    }
    const repo = repoOf(input.repo);
    if (!repo) return { error: 'Give the name of a model on Hugging Face, like nvidia/Qwen3.6-35B-A3B-NVFP4.' };
    if (library.some((e) => e.repo && e.repo.toLowerCase() === repo.toLowerCase())) return { error: `${repo} is already in the list.` };
    // A built-in model the operator removed, added back by its name: its own entry again, with its measured flags.
    const builtIn = VLLM_LIBRARY.find((e) => e.repo && e.repo.toLowerCase() === repo.toLowerCase());
    if (builtIn && !ids.has(builtIn.id)) return { entry: JSON.parse(JSON.stringify({ ...blank, ...builtIn })) };
    const [owner, name] = repo.split('/');
    // Two owners' models of the same name would share a folder: the second one gets its owner's name in front.
    const folder = library.some((e) => folderOf(e) === name) ? `${owner}--${name}` : null;
    return { entry: { ...blank, id: idFor(name), label: label(name), repo, folder, args: familyArgs(repo) } };
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
        // Plus the sliding-window layers' share, which stops growing past the window (Gemma 4: 168 MB a person;
        // measured 2026-10-09, 64 people at 30k filled 52 % of a 52 GiB pool).
        stateBytes: (m.vllm_state_charge_bytes ?? 2 * (m.recurrent_state_bytes || 0)) + (m.kv_constant_bytes_per_request || 0) * (fp8 ? 1 : 2),
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
// share kept for document reading (Ollama's OCR model) and for document search while it is on but not running yet
// (embed.js: once it runs, its memory is no longer free); on unified memory, from what the system has available, less
// the memory guard's floor too. `cap` (GiB) keeps a small model from taking the whole card. `personGib` = one
// person's conversation at the chosen context, when known.
function poolGib({ totalGib, freeGib, unified = false, memAvailableGib = null, weightsGib = 0, ocrReserveGib = 0, embedReserveGib = 0, marginPct = 8, minFreeGb = 0, cap = null, personGib = null }) {
    const marginGib = (marginPct / 100) * (totalGib || 0);
    const base = unified ? memAvailableGib : freeGib;
    const raw = (base || 0) - marginGib - (unified ? minFreeGb || 0 : 0) - weightsGib - RUNTIME_GIB - ocrReserveGib - embedReserveGib;
    let gib = Math.floor(raw);
    const capped = cap != null && gib > cap;
    if (capped) gib = cap;
    const why = { freeGib: base, weightsGib, ocrReserveGib, embedReserveGib, marginGib, runtimeGib: RUNTIME_GIB, minFreeGb: unified ? minFreeGb || 0 : 0, unified, capped };
    const ok = gib >= 1 && (personGib == null || gib >= personGib);
    if (ok) return { gib, why, ok, reason: null };
    const where = unified ? `This computer has ${r1(base || 0)} GB of memory available` : `The GPU has ${r1(base || 0)} GB free`;
    const after = `the model (${r1(weightsGib)} GB)${ocrReserveGib ? `, document reading (${r1(ocrReserveGib)} GB)` : ''}${embedReserveGib ? `, document search (${r1(embedReserveGib)} GB)` : ''}${unified && minFreeGb ? `, the ${minFreeGb} GB kept so the computer cannot run out` : ''} and a safety margin`;
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
// A model's own sampling (its --override-generation-config, Qwen3-Omni's) and the reply cap go in ONE flag: vLLM keeps
// a repeated flag's last value, so a second one would drop the first.
function argvFor(entry, s, kvGib, maxNumSeqs) {
    const own = [...(entry.args || [])];
    let gen = {};
    const i = own.indexOf('--override-generation-config');
    if (i >= 0) { try { gen = JSON.parse(own[i + 1]); } catch { gen = {}; } own.splice(i, 2); }
    if (s.maxReply) gen = { ...gen, max_new_tokens: s.maxReply };
    return [
        '--served-model-name', s.modelId,
        '--max-model-len', String(s.ctx),
        '--max-num-seqs', String(maxNumSeqs),
        '--kv-cache-memory-bytes', String(Math.round(kvGib * GIB)),
        ...own,
        ...(Object.keys(gen).length ? ['--override-generation-config', JSON.stringify(gen)] : []),
        ...s.extraArgs,
    ];
}

const minFreeOf = (v, unified) => (v === 'auto' ? (unified ? 8 : null) : v || null);

// Everything a start needs, or why it cannot start. `st` = parseStatus; `mem` = memOf(st) measured just before the
// start (after Ollama's models were evicted).
// `embedReserveGib`: up.js passes embed.RESERVE_GIB while document search is on and not running yet (it starts before
// the engine at a boot, so then its memory is already taken).
function planFor(config, st, mem = memOf(st), { ocrEnabled = !!(config.ocr && config.ocr.enabled), embedReserveGib = 0 } = {}) {
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
        ocrReserveGib: ocrEnabled ? v.ocrReserveGib : 0, embedReserveGib, marginPct: v.marginPct, minFreeGb: minFreeGb || 0, personGib: pb ? pb / GIB : null,
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

// Apply on vLLM, the pure half (§5.6): the panel's fields checked against the list and the last check of this
// computer, and whether the EFFECTIVE launch changes against what vLLM runs with (D9: an Automatic memory keeps the
// amount vLLM was started with; it is worked out again only at the next start). A new model, context, memory or
// request cap restarts vLLM (48 → 80 people does, through the cap 128 → 256); people at once inside the cap and the
// name do not. `body.name` comes checked; `launch` = what vLLM runs with, null when it does not run.
// → {error} | {patch, restart, seats, changes}.
function applyChange(config, body = {}, { st = null, launch = null, root = config.vllm.root } = {}) {
    const v = config.vllm;
    const patch = {};
    if (body.name != null && body.name !== v.alias) patch.alias = body.name;
    if (body.slots != null) {
        const n = body.slots === 'auto' ? 'auto' : Math.round(Number(body.slots));
        if (n !== 'auto' && (!Number.isFinite(n) || n < 1 || n > 512)) return { error: 'People at once must be Automatic, or between 1 and 512.' };
        if (n !== v.parallel) patch.parallel = n;
    }
    if (body.model != null && body.model !== v.model) {
        const e = (v.library || []).find((x) => x.id === body.model);
        if (!e) return { error: 'That model is not in the vLLM list.' };
        const m = st && st.models.find((f) => f.folder === folderOf(e));
        if (!m || m.partial) return { error: `${e.label} is not downloaded yet: press Download next to it.` };
        patch.model = e.id;
    }
    const entry = vllmEntry({ vllm: { ...v, ...patch } });
    if (body.context != null) {
        const ctx = Math.round(Number(body.context));
        const disk = st && entry && st.models.find((f) => f.folder === folderOf(entry));
        const native = facts(entry).nativeCtx || (disk && disk.native) || null;
        if (!Number.isFinite(ctx) || ctx < 4096 || (native && ctx > native)) {
            return { error: `Context per person must be between 4096 and ${native ? `${native} tokens (this model's maximum)` : 'the model\'s maximum'}.` };
        }
        if (ctx !== v.contextLength) patch.contextLength = ctx;
    } else if ('model' in patch) {
        // Another model with the same context per person: vLLM refuses a context longer than the model reads.
        const disk = st && st.models.find((f) => f.folder === folderOf(entry));
        const native = facts(entry).nativeCtx || (disk && disk.native) || null;
        if (native && v.contextLength > native) return { error: `${entry.label} reads at most ${native} tokens: choose a context per person of ${native} or less with it.` };
    }
    if (body.kvCacheGib != null) {
        const kv = body.kvCacheGib === 'auto' ? 'auto' : Number(body.kvCacheGib);
        const card = st && st.gpu ? memOf(st).totalGib : null;
        if (kv !== 'auto' && (!Number.isFinite(kv) || kv < 1 || (card && kv > card))) {
            return { error: `GPU memory for conversations must be Automatic, or between 1 and ${card ? `${Math.floor(card)} GB` : 'the card\'s size'}.` };
        }
        if (kv !== v.kvCacheGib) patch.kvCacheGib = kv;
    }
    const next = { ...v, ...patch };
    const s = settingsOf({ ...config, vllm: next }, root);
    const f = facts(entry);
    const kvEff = next.kvCacheGib === 'auto' ? (launch ? launch.kvGib : null) : next.kvCacheGib;
    const seats = next.parallel === 'auto'
        ? seatsAuto(entry, st && st.gpu ? st.gpu.name : null, next.contextLength, peopleFit(kvEff, next.contextLength, f)).seats : next.parallel;
    const maxNumSeqs = next.maxNumSeqs === 'auto' ? maxNumSeqsAuto(seats) : next.maxNumSeqs;
    const pb = personBytes(next.contextLength, f);
    if (kvEff != null && pb != null && kvEff * GIB < pb) {
        return { error: `${kvEff} GB of GPU memory for conversations is less than one person's conversation needs at this context (${r1(pb / GIB)} GB): give vLLM more, or lower the context per person.` };
    }
    const restart = !!launch && (s.modelId !== launch.modelId || s.ctx !== launch.ctx || kvEff !== launch.kvGib
        || maxNumSeqs !== launch.maxNumSeqs || s.maxReply !== launch.maxReply || JSON.stringify(s.extraArgs) !== JSON.stringify(launch.extraArgs));
    const changes = [];
    if ('alias' in patch) changes.push(`name "${patch.alias}"`);
    if ('parallel' in patch) changes.push(patch.parallel === 'auto' ? `people at once automatic (${seats})` : `${patch.parallel} people at once`);
    if ('contextLength' in patch) changes.push(`${Math.round(patch.contextLength / 1024)}k of context each`);
    if ('kvCacheGib' in patch) changes.push(patch.kvCacheGib === 'auto' ? 'GPU memory for conversations automatic' : `${patch.kvCacheGib} GB for conversations`);
    if ('model' in patch) changes.push(entry.label);
    return { patch, restart, seats, changes };
}

// ---- what to do ----------------------------------------------------------------------------------------------------

// At boot, with vLLM the engine: serve with the running server at once, wait for one that is starting, restart one
// launched otherwise, or start one. A server that runs with these settings is kept whatever the check says: a
// problem there (a GPU nvidia-smi missed once, a slow disk check) would otherwise send the farm to Ollama beside it.
// `noAnswer` (unanswered): WSL or status.sh gave no answer at all (Windows still starting at log on, a distribution
// still booting). The start is queued instead: it checks again once the farm is up, keeps a server it then finds
// running with these settings (keepRunning), and serves with Ollama only if that check fails too. Falling back here
// would leave everyone on Ollama for the whole run after one slow log on.
function bootDecision({ supported: sup = { ok: true }, problems = [], running = null, adopt = null, noAnswer = false }) {
    if (!sup.ok) return { action: 'unavailable', reason: UNSUPPORTED };
    if (running && adopt && adopt.ok) return { action: running.ready ? 'adopt' : 'wait', reason: null };
    if (noAnswer && !running) return { action: 'start', reason: null };
    if (problems.length) return { action: 'unavailable', reason: problems[0] };
    return { action: running ? 'restart' : 'start', reason: null };
}

// The check got no answer from this computer's Linux (as opposed to an answer that says what is missing).
function unanswered(pr) {
    return !!(pr && !pr.st && !pr.missing && (pr.stError || (pr.wsl && pr.wsl.error === 'timeout')));
}

// A start (Start, a switch, a restart after a stop) meets a vLLM already running from its root: keep it when it runs
// with these settings, is ready and answers on its port, instead of stopping it to start the same thing again (2
// minutes nobody can chat). One that is not ready, or whose port is dead (the relay), is stopped and started: a hung
// server counts as a crash (§5.7).
function keepRunning({ running = null, adopt = null, answers = false }) {
    return !!(running && running.ready && adopt && adopt.ok && answers);
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

// ---- taking over a vLLM the farm routes to as an external server (§9) ---------------------------------------------

// "Let the farm run vLLM": the external server the farm routes to on `port` runs on this computer from farm/vllm's
// scripts, so the farm can run it itself. → null (nothing to offer), or {root, distro, port, running, ready, pgid,
// block, resolved}: `block` is the farm's vllm block for it, with the model, name and settings it runs with (and its
// other flags last, in extraArgs). A running server is offered only when the farm can keep it exactly as it runs
// (adoptable), so taking over restarts nothing. `st` = status.sh at the root a serve.sh on that port runs from, else
// at an install; `answering` = whether something answers on that port now (then it must be that serve.sh).
function takeOverPlan(config, st, port, { answering = false } = {}) {
    const ex = config.external;
    if (!st || !st.root || !st.installs.some((i) => i.root === st.root)) return null;
    const found = st.found.find((f) => f.port === port);
    const run = found && st.running && found.root === st.root && found.pgid === st.running.pgid && st.running.argv.length ? st.running : null;
    // A serve.sh on that port from another root; or, with none there, a server that is not one, or this root's own
    // server on another port: not ours to take.
    if (found ? !run : (answering || st.running)) return null;
    const have = run ? flagMap(run.argv.slice(1)) : {};
    if (have['--api-key']) return null;   // the farm's route sends its own key: a server that checks one would refuse it
    const id = run ? have['--served-model-name'] : ex.model;
    const lib = config.vllm.library || [];
    const base = lib.find((e) => e.id === id);
    const prefix = `${st.root}/hf/`;
    const folder = run ? (String(run.argv[0]).startsWith(prefix) ? run.argv[0].slice(prefix.length) : null) : folderOf(base);
    if (typeof id !== 'string' || !folder || !FOLDER_RX.test(folder)) return null;
    if (!run && !(base && st.models.some((m) => m.folder === folder && !m.partial))) return null;
    // The model: its entry in the list, kept as the server runs it where that differs (its folder; the presence
    // penalty and vision the farm sent it as an external server, so the routing stays the same); else a new entry.
    const entry = base ? { ...base } : {
        id, label: id, repo: null, folder, sizeGb: null, weightsGib: null, vision: null, presencePenalty: null,
        args: familyArgs(folder), catalog: null, measured: null, note: '',
    };
    if (folderOf(entry) !== folder) entry.folder = folder;
    if ((entry.presencePenalty ?? null) !== (ex.presencePenalty ?? null)) entry.presencePenalty = ex.presencePenalty ?? null;
    if (entry.vision !== !!ex.vision) entry.vision = !!ex.vision;
    const changed = !base || JSON.stringify(entry) !== JSON.stringify(base);
    if (changed) entry.note = `${base && base.note ? `${base.note} ` : ''}Kept as it ran when the farm took it over.`;
    const num = (k) => (/^\d+$/.test(String(have[k] ?? '')) ? Number(have[k]) : null);
    const seqs = num('--max-num-seqs'); const kvBytes = num('--kv-cache-memory-bytes');
    const unified = memOf(st).unified;
    // What the farm declared (the name, people at once, context), and what the server runs with when it runs; a
    // server that does not run keeps the farm's own settings for the rest (Automatic, unless set before).
    const block = {
        enabled: true, root: st.root, ...(st.distro ? { distro: st.distro } : {}), port, alias: ex.alias, model: id,
        contextLength: num('--max-model-len') || ex.contextLength, parallel: ex.parallel,
        ...(run ? {
            kvCacheGib: kvBytes ? kvBytes / GIB : 'auto',
            maxNumSeqs: seqs == null || seqs === maxNumSeqsAuto(ex.parallel) ? 'auto' : seqs,
            // The memory guard as it runs: none on a box whose GPU shares the memory is 0 there (Automatic is 8).
            minFreeGb: run.minFreeGb != null ? run.minFreeGb : unified ? 0 : 'auto',
            extraArgs: [],
        } : {}),
        ...(changed ? { library: base ? lib.map((e) => (e.id === id ? entry : e)) : [...lib, entry] } : {}),
    };
    const parse = () => {
        const r = ConfigSchema.shape.vllm.safeParse(JSON.parse(JSON.stringify({ library: lib, ...block })));
        return r.success ? { ...config, vllm: r.data } : null;
    };
    const out = { root: st.root, distro: st.distro || null, port, running: !!run, ready: !!(run && run.ready), pgid: run ? run.pgid : null, block, resolved: null };
    if (!run) return parse() ? out : null;
    // The server's other flags, and any value that differs from the entry's, go last (vLLM keeps a repeated flag's
    // last value, and so does flagMap). A flag the farm would add that the server runs without cannot be said: no offer.
    const opts = { unified, gpuName: st.gpu && st.gpu.name, root: st.root };
    let cfg = parse();
    if (!cfg) return null;
    for (const k of adoptable(cfg, run, opts).diff) {
        if (!(k in have) || ['model', 'port', 'minFreeGb'].includes(k)) return null;
        block.extraArgs.push(k, ...(have[k] === true ? [] : [typeof have[k] === 'object' ? JSON.stringify(have[k]) : String(have[k])]));
    }
    cfg = parse();
    const a = cfg && adoptable(cfg, run, opts);
    return a && a.ok ? { ...out, resolved: a.resolved } : null;
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

// What an install or a download is doing, from install.sh's [lol-step] (§4.3). The meter is the folder on disk, and
// Hugging Face's downloader writes a file in large pieces, late (the live test: 0.02 GB for the first 80 s of a 1.5 GB
// model, then a jump): the text says so, so a low number does not read as stuck (the bar shows the time it has run).
function installStepText(step, { label = 'the model', version = '', bytes = null, total = null } = {}) {
    if (step === 'model' && bytes != null) {
        const gb = (n) => (n / 1e9 >= 10 ? Math.round(n / 1e9) : Math.round(n / 1e8) / 10);
        return `downloading ${label} — ${gb(bytes)}${total ? ` of ${gb(total)}` : ''} GB on disk so far (files are written in large pieces, so this number jumps)`;
    }
    return {
        uv: 'getting the installer (uv)',
        venv: 'creating the Python environment',
        vllm: `downloading vLLM${version ? ` ${version}` : ''} and its GPU libraries (about 8 GB)`,
        'cuda-pins': 'matching the CUDA compiler to the GPU libraries',
        check: 'checking the GPU',
        model: `downloading ${label}`,
        done: 'finishing',
    }[step] || 'working';
}

// A download that failed, in the words §7.3 gives (install.sh's [lol-error] kind).
function downloadFailure(r, repo, button = 'Download') {
    if (r.kind === 'gated') return 'Hugging Face asks for an account to download this model. Pick another model.';
    if (r.kind === 'notfound') return `There is no model named ${repo} on Hugging Face. Check the name.`;
    if (r.kind === 'disk') return `The disk is full. Free some space, then press ${button} again.`;
    if (r.kind === 'noinstall') return 'vLLM is not installed on this computer yet: press Install vLLM first.';
    // A Python exception's type name says nothing to a person: "httpx.ReadTimeout: …", "OSError: …".
    const why = String(r.error || '').replace(/^(\w+(\.\w+)+|\w+(Error|Exception)):\s*/, '').slice(0, 160) || 'no answer';
    return `The download stopped: ${why}. Press ${button} again to go on: the files it finished are kept.`;
}

// ---- what blocks it on this computer -------------------------------------------------------------------------------

// Can a model of the vLLM list run on a GPU of `gib` GB at all: what the smallest one asks of an EMPTY card (poolGib's
// sum: its weights, vLLM's own memory, the safety margin, document reading's share while it is on, the memory guard's
// floor where the GPU shares the system memory, and 1 GB for conversations). → {fits, needGib, ocrGib, fitsWithoutOcr},
// or null with no list or no size. An RTX 4070 (12 GB) or 4080 (16 GB) fits none: llama.cpp or Ollama is their engine.
// A model whose size the list does not know (one added by its name) is left out: counted as 0 GB, it made any card fit.
function gpuFit(config, gib, { unified = false } = {}) {
    const v = config.vllm;
    const sizes = (v.library || []).map((e) => e.weightsGib ?? (e.sizeGb > 0 ? e.sizeGb * 1e9 / GIB : null)).filter((w) => w != null);
    if (!sizes.length || !(gib > 0)) return null;
    const weights = Math.min(...sizes);
    const ocrGib = config.ocr && config.ocr.enabled ? v.ocrReserveGib : 0;
    const embedGib = config.embed && config.embed.enabled === true ? EMBED_RESERVE_GIB : 0;   // document search, beside it
    const floor = unified ? minFreeOf(v.minFreeGb, true) || 0 : 0;
    const need = (ocr) => (weights + RUNTIME_GIB + 1 + ocr + embedGib + floor) / (1 - v.marginPct / 100);
    return { fits: gib >= need(ocrGib), needGib: need(ocrGib), ocrGib, fitsWithoutOcr: gib >= need(0) };
}
// The sentence for a GPU no model of the list fits, or null when one does (or its size is unknown).
function tooSmallText(config, gib, opts) {
    const f = gpuFit(config, gib, opts);
    if (!f || f.fits) return null;
    const ocr = f.ocrGib ? `, with ${r1(f.ocrGib)} GB kept for document reading` : '';
    const room = f.ocrGib && f.fitsWithoutOcr ? ' Turning document reading off would make room for one.' : '';
    return `This GPU has ${r1(gib)} GB: too little for any model in the vLLM list (the smallest needs about ${r1(f.needGib)} GB${ocr}). llama.cpp or Ollama is the engine for this card.${room}`;
}
// What Windows itself sees of the GPU, from systemInfo.detectHardware's result: {name, gb}, name null when its
// nvidia-smi did not answer. up.js reads it at boot, and again before each check while the name is missing: nvidia-smi
// can be slow at log on, and the checklist would say "no NVIDIA GPU" (or miss "too small") for the whole run.
function hostGpuOf(hw) {
    return { name: hw.gpu === 'Unknown GPU' ? null : hw.gpu, gb: hw.vramGb || null };
}
const NO_NVIDIA = 'No NVIDIA GPU was found on this computer (nvidia-smi does not answer). vLLM needs one: if this computer has one, install its latest NVIDIA driver, restart the computer, then press Check again; if not, llama.cpp or Ollama is the engine for it.';

// The checklist the panel shows: `oks` (done), `problems` (each blocks a start) and `warnings` (said, not blocking).
// `probe` = {platform, arch, wsl: {list} | {error: 'no-wsl'|'no-distro'|'timeout'}, distro, st (parseStatus) | null,
// stError, hostDiskFreeGb, hostDrive, hostGpu}; `entry` = the model to check (the selected one by default).
// `hostGpu` = what Windows itself sees ({name, gb}, name null when its nvidia-smi does not answer; up.js passes
// detectHardware's): a GPU too small for any model, or no NVIDIA GPU at all, is said before anything about WSL, which
// would otherwise be installed for nothing.
function problemsFrom(probe, config, entry = vllmEntry(config)) {
    const oks = []; const problems = []; const warnings = []; let gpuTooSmall = false;
    const done = () => ({ oks, problems, warnings, gpuTooSmall });
    const sup = supported(probe.platform, probe.arch);
    if (!sup.ok) { problems.push(UNSUPPORTED); return done(); }
    const win = probe.platform === 'win32';
    const timeout = 'WSL did not answer. Restart the computer, then press Check again.';
    const host = win && probe.hostGpu ? probe.hostGpu : null;
    // Windows' own nvidia-smi saw no NVIDIA GPU: said instead of WSL's advice, but only where WSL cannot contradict it
    // (missing, or seeing no GPU either), since a slow nvidia-smi at log on reads the same.
    const noNvidia = !!(host && !host.name);
    const small = host && host.name && host.gb ? tooSmallText(config, host.gb) : null;
    if (small) { problems.push(small); gpuTooSmall = true; return done(); }
    let distro = null;
    if (win) {
        const w = probe.wsl || {};
        if (noNvidia && w.error !== 'timeout' && !(probe.st && probe.st.gpu)) { problems.push(NO_NVIDIA); return done(); }
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
    if (!st && probe.missing) { problems.push(probe.stError); return done(); }
    if (!st) { problems.push(win ? timeout : `This computer did not answer the check${probe.stError ? ` (${probe.stError})` : ''}. Press Check again.`); return done(); }
    if (!['x86_64', 'aarch64'].includes(st.arch)) { problems.push('vLLM needs a 64-bit Intel, AMD or ARM processor.'); return done(); }
    if (!st.gpu) {
        problems.push(win
            ? `${distro} cannot see the GPU. Install the latest NVIDIA driver for Windows (it also serves WSL), restart the computer, then press Check again.`
            : NO_NVIDIA);
        return done();
    }
    const mem = memOf(st);
    const gpuGb = r1(mem.totalGib || 0);
    oks.push(win ? `${distro} sees the GPU: ${st.gpu.name} (${gpuGb} GB).`
        : mem.unified ? `GPU: ${st.gpu.name} (${gpuGb} GB shared with the system).` : `GPU: ${st.gpu.name} (${gpuGb} GB).`);
    const tooSmall = tooSmallText(config, mem.totalGib || 0, { unified: mem.unified });
    if (tooSmall) {
        gpuTooSmall = true;   // nothing to install for: the panel offers no Install
        problems.push(tooSmall);
    } else if (st.gpu.cap != null && st.gpu.cap < 12) {
        warnings.push('This GPU is older than the cards these models were measured on (RTX PRO 6000, DGX Spark): they may not load. If a start fails, llama.cpp is the engine for this card.');
    }
    // What a person types, and where: on Windows in the distribution's own window (the Start menu opens it).
    const apt = (pkg) => `${win ? `Open ${distro} from the Start menu, run` : 'In a terminal, run'}  sudo apt install ${pkg} , then press Check again.`;
    if (!st.curl) problems.push(`curl is missing. ${apt('curl')}`);
    // vLLM compiles a small GPU launcher (Triton) and kernels (FlashInfer) at a start, with the system's C compiler;
    // a fresh Ubuntu in WSL has none, and the start would fail with a Python error nobody can act on.
    if (!st.cc) problems.push(`vLLM needs a C compiler to prepare the GPU, and this ${win ? `${distro}` : 'computer'} has none. ${apt('build-essential')}`);
    const root = resolveRoot(config, st);
    const inst = st.installs.find((i) => i.root === root);
    if (inst) {
        oks.push(config.vllm.root ? `vLLM ${inst.version} is installed (in ${root}).` : `Found an existing vLLM in ${root}: the farm will use it.`);
        if (inst.version !== config.vllm.version) warnings.push(`vLLM ${inst.version} is installed; this farm was tested with ${config.vllm.version}.`);
        // An install from before the sound extras (farm-v0.0.44 and earlier): text and pictures work, a message with
        // sound fails. Update vLLM adds them in a few minutes.
        else if (entry && entry.audio && !inst.audio) warnings.push(`${entry.label} hears sound in a message, and the vLLM installed here cannot read sound yet: press Update vLLM (a few minutes; text and pictures work meanwhile).`);
    } else {
        problems.push('vLLM is not installed on this computer yet: press Install vLLM.');
    }
    // The farm's own model download (installKind 'download') never blocks using another model; an install, or a
    // download nobody here started, does.
    if (st.installing && probe.installKind !== 'download') problems.push('A download started earlier is still running. Wait for it, or stop it here.');
    const label = entry ? entry.label : config.vllm.model;
    const m = entry && st.models.find((x) => x.folder === folderOf(entry));
    if (!entry) problems.push(`The model "${config.vllm.model}" is not in the vLLM list: pick one there.`);
    // Before vLLM is installed the list has no Download button (Install vLLM downloads the chosen model with it).
    else if (!m) problems.push(inst ? `${label} is not downloaded yet: press Download next to it.` : `${label} is not downloaded yet: Install vLLM downloads it too.`);
    else if (m.partial) problems.push(`${label} is only partly downloaded: press Download to finish it.`);
    const disk = diskCheck(probe, entry, { venv: !inst, distro });
    if (disk.problem) problems.push(disk.problem);
    else if (Number.isFinite(disk.free)) oks.push(`${r1(disk.free)} GB free for vLLM and its models.`);
    return done();
}

// The disk an install or a download needs (§4.2): about 10 GB for vLLM itself when its Python environment is (re)made
// (`venv`), plus what is left of the model; against what is free, on Windows the smaller of WSL's own disk (a virtual
// disk that reports up to 1 TB) and the Windows drive that holds it. A download also leaves `keepGb` free: WSL's disk
// grows on drive C: and never gives the space back, and a full C: stops Windows itself. → {need, free, problem}.
function diskCheck(probe, entry, { venv = false, keepGb = 0, button = 'Check', distro = null } = {}) {
    const st = (probe && probe.st) || {};
    const m = entry && (st.models || []).find((x) => x.folder === folderOf(entry));
    const model = entry && !(m && !m.partial) ? Math.max(0, (entry.sizeGb || 0) - (m ? m.gb : 0)) : 0;
    const need = (venv ? 10 : 0) + model;
    const free = Math.min(st.diskFreeGb ?? Infinity, (probe && probe.hostDiskFreeGb) ?? Infinity);
    if (!(need > 0 && free < need + keepGb)) return { need, free, problem: null };
    const label = entry ? entry.label : 'the model';
    const what = !venv ? `${label} needs` : model ? `vLLM and ${label} need` : 'vLLM needs';
    const where = probe && probe.platform === 'win32' && probe.hostDrive ? ` ${distro || probe.distro || st.distro || 'WSL'}'s disk lives on drive ${probe.hostDrive}:.` : '';
    const keep = keepGb ? ` (the farm leaves ${keepGb} GB free beside it)` : '';
    return { need, free, problem: `Not enough free disk: ${what} about ${r1(need)} GB, and ${r1(Math.max(0, free))} GB are free${keep}.${where} Free some space, then press ${button} again.` };
}

// Does document reading's model (Ollama's, driven directly) fit the memory kept for it beside vLLM (§1.4)? Its size
// in the GPU when it is loaded, else its size on disk + 1 GiB. → {gb, fits}, or null when its size is unknown.
function ocrFit({ sizeBytes = 0, vramBytes = 0, reserveGib = 0 } = {}) {
    const b = vramBytes || (sizeBytes ? sizeBytes + GIB : 0);
    if (!b) return null;
    return { gb: r1(b / GIB), fits: b / GIB <= reserveGib };
}

function baseUrl(config) { return `http://127.0.0.1:${config.vllm.port}/v1`; }

// ---- the process half: running the scripts --------------------------------------------------------------------
// A TARGET is where one vLLM lives: {platform, distro (Windows: the WSL distribution, null = WSL's default), root
// (absolute, or "~/…" which the scripts expand), port}. Every wsl.exe call has a timeout: WSL can hang.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CANDIDATE_ROOTS = '~/lol-vllm:~/lol-spike';   // ponytail: the second is where this project's spike installed vLLM
const ROOT_RX = /^(\/[\w.-]+)+$/;
const FOLDER_RX = /^[\w.-]+$/;
const lastLine = (s) => String(s || '').split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean).pop() || '';
const asConfig = (t) => ({ vllm: { distro: t.distro || null } });

// Is an OpenAI-compatible server answering at baseUrl? GET {baseUrl}/models is the one call every such server has
// (vLLM, SGLang, llama-server, TensorRT-LLM's shim). 401/403 count as answering: it IS there, the key is the
// problem. Never throws.
function answers(base, timeoutMs = 4000, headers = {}) {
    return new Promise((resolve) => {
        let url;
        try { url = new URL(`${String(base).replace(/\/+$/, '')}/models`); } catch { return resolve(false); }
        const req = (url.protocol === 'https:' ? https : http).request(url, { method: 'GET', timeout: timeoutMs, headers }, (res) => {
            res.resume();
            resolve((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 401 || res.statusCode === 403);
        });
        req.on('timeout', () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
        req.end();
    });
}

// Run a command to its end, or kill it at its timeout. Never throws: {code, out, err, timedOut, error}. `onLine`
// gets each stdout line as it comes (\r ends a line too: progress bars).
function runCmd(cmd, args, { cwd, env, timeoutMs = 60000, onLine = null } = {}) {
    return new Promise((resolve) => {
        let child;
        try { child = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (e) { return resolve({ code: null, out: '', err: '', timedOut: false, error: e.code || e.message }); }
        const out = []; const err = []; let rest = ''; let done = false;
        const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
        const timer = setTimeout(() => {
            try { child.kill(); } catch { /* gone */ }
            finish({ code: null, out: decodeWsl(Buffer.concat(out)), err: decodeWsl(Buffer.concat(err)), timedOut: true, error: 'timeout' });
        }, timeoutMs);
        child.stdout.on('data', (d) => {
            out.push(d);
            if (!onLine) return;
            const parts = (rest + d.toString('utf8')).split(/\r\n|\r|\n/);
            rest = parts.pop();
            for (const l of parts) if (l) onLine(l);
        });
        child.stderr.on('data', (d) => err.push(d));
        child.on('error', (e) => finish({ code: null, out: '', err: '', timedOut: false, error: e.code || e.message }));
        child.on('close', (code) => {
            if (onLine && rest) onLine(rest);
            finish({ code, out: decodeWsl(Buffer.concat(out)), err: decodeWsl(Buffer.concat(err)), timedOut: false, error: null });
        });
    });
}

// A script of farm/vllm that is not on disk: the Farm app's update of the farm's files did not finish (Electron's
// copy stopped at a file a running vLLM held, farm-v0.0.43 on the PRO 6000, 2026-10-08). Said as such, never as
// "WSL did not answer", which sent the operator to restart the computer.
const missingScript = (script) => `A file of the farm is missing (vllm/${script}): its last update did not finish. `
    + 'Restart the farm to complete it (in the Farm app: Quit, then open it again).';
function spawnScript(config, script, env = {}, { timeoutMs = 60000, onLine = null, args = [], distro } = {}) {
    if (!fs.existsSync(path.join(VLLM_DIR, script))) {
        return Promise.resolve({ code: null, out: '', err: '', timedOut: false, error: missingScript(script), missing: script });
    }
    const c = scriptCommand(config, script, env, { args, ...(distro !== undefined ? { distro } : {}) });
    return runCmd(c.cmd, c.args, { cwd: c.cwd, env: c.env, timeoutMs, onLine });
}

// WSL's distributions, or {error: 'no-wsl' | 'no-distro' | 'timeout'}. `wsl -l -v` lists them without booting the VM.
async function wslDistros() {
    return wslAnswer(await runCmd('wsl.exe', ['-l', '-v'], { timeoutMs: 15000 }));
}
// What `wsl -l -v` said (runCmd's result; pure, for the tests). 'no-distro' only when WSL says it has none: its
// English or French words (from wsl.exe 2.x's own strings), or its error code, the same in every language, where it
// prints one. Any other failure without a list is 'timeout', no answer (unanswered): WSL's service not ready yet at a
// slow log on reads so, and the start is queued instead of Ollama serving for the whole run. ponytail: another
// language without the code reads as no answer too (the queued start's check then says WSL did not answer); add its
// words here when one is met.
function wslAnswer(r) {
    if (r.timedOut) return { error: 'timeout' };
    if (r.error) return { error: 'no-wsl' };
    const list = parseWslList(r.out);
    if (list.length) return list;
    const text = `${r.out}\n${r.err}`;
    // French Windows writes n’est with a typographic apostrophe (KernelBase.dll.mui, fr-FR).
    if (/is not installed|n['’]est pas install/i.test(text)) return { error: 'no-wsl' };
    return /has no installed distributions|aucune distribution install|WSL_E_DEFAULT_DISTRO_NOT_FOUND/i.test(text) ? { error: 'no-distro' } : { error: 'timeout' };
}

// The Windows folder a distribution's virtual disk lives in, from `reg query …\Lxss /s` (pure, for the tests).
function lxssBasePath(regOut, distro) {
    let name = null; let base = null;
    for (const line of String(regOut || '').split(/\r?\n/)) {
        if (/^HKEY_/.test(line)) { if (name === distro && base) return base; name = null; base = null; continue; }
        const m = /^\s+(DistributionName|BasePath)\s+REG_\w+\s+(.*?)\s*$/.exec(line);
        if (m && m[1] === 'DistributionName') name = m[2];
        else if (m) base = m[2].replace(/^\\\\\?\\/, '');
    }
    return name === distro && base ? base : null;
}

// Free space on the Windows drive that holds the distribution: WSL's own `df` reports its virtual disk (up to 1 TB),
// not what drive C: has left. Linux: nothing to add.
async function hostDiskFree(distro) {
    if (process.platform !== 'win32') return { gb: null, drive: null };
    const r = await runCmd('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss', '/s'], { timeoutMs: 10000 });
    const base = (distro && lxssBasePath(r.out, distro)) || process.env.LOCALAPPDATA || 'C:\\';
    try {
        const s = fs.statfsSync(base);
        return { gb: (s.bavail * s.bsize) / 1e9, drive: (/^([A-Za-z]):/.exec(base) || [])[1]?.toUpperCase() || null };
    } catch { return { gb: null, drive: null }; }
}

// status.sh for one target → {st (parseStatus) | null, error, timedOut}.
async function status(t, { roots = '', timeoutMs = 60000 } = {}) {
    const r = await spawnScript(asConfig(t), 'status.sh', {
        LOL_VLLM_ROOT: t.root || '~/lol-vllm', LOL_VLLM_PORT: String(t.port || 8100), ...(roots ? { LOL_VLLM_ROOTS: roots } : {}),
    }, { timeoutMs, distro: t.distro || null });
    if (r.timedOut) return { st: null, error: 'timeout', timedOut: true };
    if (r.missing) return { st: null, error: r.error, timedOut: false, missing: true };
    if (r.code !== 0 || !/^home=/m.test(r.out)) return { st: null, error: lastLine(r.err || r.out || r.error).slice(0, 200) || `status ${r.code}`, timedOut: false };
    return { st: parseStatus(r.out), error: null, timedOut: false };
}

// The check of this computer (§4.1), never per panel poll: on Windows WSL's list first, then status.sh (60 s: it
// boots a stopped distribution) and the host drive. With no root configured it looks in the candidate roots, and
// asks again from the one an install was found in, so `running` describes that root.
async function probe(config, { roots = CANDIDATE_ROOTS, hostGpu = null } = {}) {
    const platform = process.platform; const arch = process.arch;
    const out = { at: Date.now(), platform, arch, wsl: null, distro: null, st: null, stError: null, hostDiskFreeGb: null, hostDrive: null, hostGpu };
    if (!supported(platform, arch).ok) return out;
    if (platform === 'win32') {
        const w = await wslDistros();
        out.wsl = Array.isArray(w) ? { list: w } : w;
        if (!Array.isArray(w)) return out;
        out.distro = config.vllm.distro || defaultDistro(w);
        const d = w.find((x) => x.name === out.distro);
        if (!d || d.version !== 2) return out;
    }
    const at = (root) => status({ platform, distro: out.distro, root, port: config.vllm.port }, { roots });
    let s = await at(config.vllm.root || '~/lol-vllm');
    if (s.st && !config.vllm.root) {
        const want = resolveRoot(config, s.st);
        if (want !== s.st.root) s = await at(want);
    }
    out.st = s.st; out.stError = s.error; out.missing = !!s.missing;
    if (s.timedOut && platform === 'win32') out.wsl = { error: 'timeout' };
    if (platform === 'win32') { const h = await hostDiskFree(out.distro); out.hostDiskFreeGb = h.gb; out.hostDrive = h.drive; }
    return out;
}

// Where the check says vLLM lives (null until a check answered).
function targetOf(config, pr) {
    if (!pr || !pr.st) return null;
    return { platform: pr.platform, distro: pr.distro || pr.st.distro || null, root: resolveRoot(config, pr.st), port: config.vllm.port };
}

// vLLM's log as a file this process can read: on Windows through the \\wsl.localhost share (no wsl.exe per read).
function logFile(t) {
    if (!t || !t.root || !t.root.startsWith('/')) return null;
    if (t.platform !== 'win32') return `${t.root}/logs/vllm.log`;
    return t.distro ? path.win32.join(`\\\\wsl.localhost\\${t.distro}`, ...t.root.split('/').filter(Boolean), 'logs', 'vllm.log') : null;
}

// The log from `fromByte` on (rotation-safe: a file smaller than the offset is a new one), or its last `lastLines`
// lines as a terminal shows them (a \r progress bar keeps only its last state). → {text, size}.
async function readLog(t, { fromByte = null, lastLines = null, maxBytes = 1 << 20 } = {}) {
    const file = logFile(t);
    if (file) {
        try {
            const size = fs.statSync(file).size;
            let from = fromByte == null ? Math.max(0, size - (lastLines ? 256 * 1024 : maxBytes)) : logOffset(size, fromByte);
            from = Math.max(from, size - maxBytes);
            const buf = Buffer.alloc(size - from);
            const fd = fs.openSync(file, 'r');
            try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
            return { text: lastLines ? tailLines(buf.toString('utf8'), lastLines) : buf.toString('utf8'), size };
        } catch (e) {
            if (e.code === 'ENOENT' || t.platform !== 'win32') return { text: '', size: e.code === 'ENOENT' ? 0 : (fromByte || 0) };
        }
    }
    if (t.platform !== 'win32' || !t.root) return { text: '', size: fromByte || 0 };
    // No share: tail through wsl.exe.
    const r = await runCmd('wsl.exe', [...(t.distro ? ['-d', t.distro] : []), '-e', 'tail',
        ...(lastLines ? ['-n', String(lastLines)] : ['-c', `+${(fromByte || 0) + 1}`]), `${t.root}/logs/vllm.log`], { timeoutMs: 15000 });
    const text = r.code === 0 ? r.out : '';
    return { text: lastLines ? tailLines(text, lastLines) : text, size: (fromByte || 0) + Buffer.byteLength(text) };
}

function tailLines(text, n) {
    return text.split('\n').map((l) => l.split('\r').filter(Boolean).pop() || '').slice(-n - 1).join('\n').replace(/^\n+/, '');
}

async function logSize(t) {
    const file = logFile(t);
    try { return file ? fs.statSync(file).size : 0; } catch { return 0; }
}

// Start serve.sh in daemon mode with the plan's env (its argv in LOL_VLLM_ARGS_B64). Detached: a crash of the farm
// leaves vLLM running and the next farm adopts it (D4). The child is wsl.exe on Windows, bash on Linux; it exits
// with serve.sh's status when vLLM ends (3 = the memory guard). → {child, fromByte}.
async function start(t, plan) {
    const fromByte = await logSize(t);
    const c = scriptCommand(asConfig(t), 'serve.sh', plan.env, { distro: t.distro || null });
    const child = spawn(c.cmd, c.args, { cwd: c.cwd, env: c.env, detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => { /* seen as an exit by waitReady */ });
    return { child, fromByte };
}

// Wait for a start: every 3 s, is the port answering, and what did the log say since `fromByte`? Fails fast when
// the child exits or the log says vLLM exited; gives up after 10 min with no new log line, or 30 min in all (a
// first start on a DGX Spark compiles kernels for minutes, silently). With no child (a start found in progress at
// boot), `isDead` (status.sh) is asked every 30 s. A start of its own (`child`) counts only once serve.sh logged
// this server ready, or status.sh says this root's server is (`isReady`, asked at most every 30 s): the port alone
// can be another program's, and routing to it would serve someone else's model. → {ok, code, lines, phase, cancelled}.
async function waitReady(t, { child = null, alive, isDead = null, isReady = null, isCancelled = () => false, onPhase = () => {}, onLine = () => {},
    fromByte = 0, pollMs = 3000, stallMs = 10 * 60e3, capMs = 30 * 60e3 } = {}) {
    let exited = null;
    if (child) {
        child.once('exit', (code) => { exited = code == null ? -1 : code; });
        child.once('error', () => { exited = -1; });
    }
    let off = fromByte; let phase = null; const lines = [];
    const t0 = Date.now(); let grew = t0; let deadAt = t0; let askedAt = 0;
    const readOn = async () => {
        const r = await readLog(t, { fromByte: off });
        if (r.size < off) off = 0;
        if (!r.text) { off = r.size; return; }
        off = r.size; grew = Date.now();
        phase = startPhase(r.text, phase);
        onPhase(phase);
        for (const l of r.text.split('\n')) {
            const shown = l.split('\r').filter(Boolean).pop();
            if (!shown) continue;
            lines.push(shown);
            if (/^\[(serve|guard)\]/.test(shown)) onLine(shown);
        }
        if (lines.length > 200) lines.splice(0, lines.length - 200);
    };
    for (;;) {
        if (isCancelled()) return { ok: false, cancelled: true, lines, phase };
        await readOn();
        if (phase && phase.key === 'exited') return { ok: false, code: phase.status, lines, phase };
        if (await alive()) {
            if (!child || (phase && phase.key === 'ready')) return { ok: true, lines, phase };
            if (isReady && Date.now() - askedAt >= 30e3) { askedAt = Date.now(); if (await isReady()) return { ok: true, lines, phase }; }
        }
        if (exited != null) { await sleep(500); await readOn(); return { ok: false, code: exited, lines, phase }; }
        const now = Date.now();
        if (!child && isDead && now - deadAt >= 30e3) { deadAt = now; if (await isDead()) return { ok: false, code: 'gone', lines, phase }; }
        if (now - grew > stallMs) return { ok: false, code: 'stall', lines, phase };
        if (now - t0 > capMs) return { ok: false, code: 'cap', lines, phase };
        await sleep(pollMs);
    }
}

// Stop the vLLM of a target: stop.sh (TERM, then KILL, its process group only), again until status.sh shows no
// running group (a stop in the first second of a start can come before serve.sh wrote its group), then until the
// port no longer answers. → {ok, error}: a failed stop must stop a switch before the next engine starts.
async function stop(t, { alive = null, attempts = 3, gapMs = 10000, portWaitMs = 15000 } = {}) {
    for (let i = 0; ; i++) {
        const r = await spawnScript(asConfig(t), 'stop.sh', { LOL_VLLM_ROOT: t.root }, { timeoutMs: 60000, distro: t.distro || null });
        const s = await status(t);
        if (s.st && !s.st.running) break;
        if (i + 1 >= attempts) {
            return { ok: false, error: s.st
                ? `vLLM did not stop: ${lastLine(r.out || r.err || r.error) || 'it is still running'}.`
                : `The farm could not check that vLLM stopped (${s.error || 'no answer'}).` };
        }
        await sleep(gapMs);
    }
    if (alive) {
        const end = Date.now() + portWaitMs;
        while (await alive()) {
            if (Date.now() > end) return { ok: false, error: `vLLM stopped, but something still answers on port ${t.port}, maybe a vLLM started outside the farm. Stop it, then try again.` };
            await sleep(1000);
        }
    }
    return { ok: true, error: null };
}

// Stop an install.sh (a download included): its own process group.
function stopInstall(t) {
    return spawnScript(asConfig(t), 'stop.sh', { LOL_VLLM_ROOT: t.root }, { timeoutMs: 60000, args: ['install'], distro: t.distro || null });
}

// The bytes under <root>/hf/<folder> so far (unfinished files included), for a download's meter; null when unreadable.
function folderBytes(t, folder) {
    const file = logFile(t);
    if (!file || !FOLDER_RX.test(folder || '')) return null;
    const dir = t.platform === 'win32' ? path.win32.join(path.win32.dirname(path.win32.dirname(file)), 'hf', folder) : `${t.root}/hf/${folder}`;
    let total = 0;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p); else if (e.isFile()) total += fs.statSync(p).size;
        }
    };
    try { walk(dir); return total; } catch { return null; }
}

// install.sh: `steps` 'venv,model' (Install, Update) or 'model' (Download). Reads its [lol-step] and [lol-error]
// lines; during the model step it measures the folder every 5 s for the meter. At `timeoutMs` it stops install.sh's
// own process group first (stop.sh install: install.sh, hf and tee), which ends the farm's child too: killing only the
// child left hf downloading on Linux (bash dies alone, its EXIT trap removes the pid file, and hf and tee carry on,
// unrecorded: the next Download ran a second one into the same folder; checked inside WSL as native Linux, 2026-10-08).
// runCmd's own kill, two minutes later, is the backstop. → {ok, kind, error, code}.
async function install(t, { steps = 'venv,model', repo = null, folder = null, version = null, sizeGb = null, timeoutMs = 6 * 3600e3 } = {}, onProgress = () => {}) {
    let kind = null; let error = null; let timer = null; const tail = [];
    const total = sizeGb ? sizeGb * 1e9 : null;
    const measure = () => { const b = folderBytes(t, folder); if (b != null) onProgress({ step: 'model', bytes: b, total }); };
    let timedOut = false;
    const limit = setTimeout(() => { timedOut = true; stopInstall(t); }, timeoutMs);
    const r = await spawnScript(asConfig(t), 'install.sh', {
        LOL_VLLM_ROOT: t.root, LOL_VLLM_STEPS: steps, ...(version ? { LOL_VLLM_VERSION: version } : {}),
    }, {
        timeoutMs: timeoutMs + 120e3, distro: t.distro || null, args: repo ? [repo, folder || repo.split('/').pop()] : [],
        onLine: (l) => {
            tail.push(l); if (tail.length > 40) tail.shift();
            let m;
            if ((m = /^\[lol-step\] (\S+)/.exec(l))) {
                onProgress({ step: m[1] });
                if (m[1] === 'model' && !timer) { timer = setInterval(measure, 5000); if (timer.unref) timer.unref(); measure(); }
            } else if ((m = /^\[lol-error\] (\w+) ?(.*)$/.exec(l))) { kind = m[1]; error = m[2]; }
        },
    });
    clearInterval(timer); clearTimeout(limit);
    if (r.code === 0 && !timedOut) return { ok: true, kind: null, error: null, code: 0 };
    if (timedOut || r.timedOut) {
        const h = timeoutMs / 3600e3;
        return { ok: false, kind: 'network', error: `it was still not done after ${h >= 1 ? `${r1(h)} hours` : `${Math.round(timeoutMs / 1000)} seconds`}`, code: null };
    }
    return { ok: false, kind, error: error || lastLine(tail.join('\n')) || r.error || `status ${r.code}`, code: r.code };
}

// A command in the target's Linux, as a direct argv (no shell): through wsl.exe on Windows.
function linuxCmd(t, argv, timeoutMs) {
    return t.platform === 'win32'
        ? runCmd('wsl.exe', [...(t.distro ? ['-d', t.distro] : []), '-e', ...argv], { timeoutMs })
        : runCmd(argv[0], argv.slice(1), { timeoutMs });
}
const goodRoot = (root) => ROOT_RX.test(root || '') && !/(^|\/)\.\.?(\/|$)/.test(root);

// Delete a model's folder: a direct argv (no shell), the root and the folder checked against their patterns first.
// The caller refuses the configured model, the running one and one being downloaded.
async function removeFolder(t, folder) {
    if (!goodRoot(t.root) || !FOLDER_RX.test(folder || '') || /^\.+$/.test(folder)) {
        return { ok: false, error: 'That is not a model folder.' };
    }
    const r = await linuxCmd(t, ['rm', '-rf', '--', `${t.root}/hf/${folder}`], 120000);
    return r.code === 0 ? { ok: true, error: null } : { ok: false, error: `Could not delete ${folder}: ${lastLine(r.err || r.error)}` };
}

// The check a take-over is offered from (§9.1): the usual check, then status.sh again at the root a serve.sh on
// `port` runs from, when that is another root (an operator's ~/lol-spike while nothing is configured, a folder of
// one's own), so `running` describes that server.
async function takeOverProbe(config, port, opts = {}) {
    const pr = await probe(config, opts);
    const f = pr.st && pr.st.found.find((x) => x.port === port);
    if (f && f.root !== pr.st.root && goodRoot(f.root)) {
        const s = await status({ platform: pr.platform, distro: pr.distro, root: f.root, port }, { roots: CANDIDATE_ROOTS });
        pr.st = s.st; pr.stError = s.error;
    }
    return pr;
}

// serve.sh's marker (its header): while it is there, a start that does not come from the farm (the old log-on task,
// lol-vllm.service, a start by hand) does nothing. Written by a take-over, removed by its Undo.
async function setMarker(t, on) {
    if (!goodRoot(t.root)) return { ok: false, error: 'That is not a vLLM folder.' };
    const steps = on ? [['mkdir', '-p', '--', `${t.root}/run`], ['touch', '--', `${t.root}/run/managed-by-farm`]] : [['rm', '-f', '--', `${t.root}/run/managed-by-farm`]];
    for (const argv of steps) {
        const r = await linuxCmd(t, argv, 30000);
        if (r.code !== 0) return { ok: false, error: `The farm could not write in ${t.root} (${lastLine(r.err || r.error) || `status ${r.code}`}).` };
    }
    return { ok: true, error: null };
}

module.exports = {
    GIB, VLLM_DIR, UNSUPPORTED, CANDIDATE_ROOTS,
    supported, decodeWsl, parseWslList, defaultDistro, scriptCommand,
    parseStatus, memOf, vllmEntry, folderOf, resolveRoot, facts, peopleFit, measuredFor, seatsAuto, maxNumSeqsAuto, poolGib,
    familyArgs, isGeneric, repoOf, newLibraryEntry, applyChange, ocrFit,
    settingsOf, argvFor, planFor, flagMap, adoptable,
    bootDecision, unanswered, keepRunning, gpuFit, hostGpuOf, downDecision, isOrphan, takeOverPlan, startPhase, logOffset, explainFailure, installStepText, downloadFailure, problemsFrom, diskCheck, baseUrl,
    answers, runCmd, spawnScript, wslDistros, wslAnswer, lxssBasePath, hostDiskFree, status, probe, targetOf, logFile, readLog,
    start, waitReady, stop, stopInstall, folderBytes, install, removeFolder, takeOverProbe, setMarker,
};
