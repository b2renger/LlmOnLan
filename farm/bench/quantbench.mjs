#!/usr/bin/env node
// quantbench — measure which Unsloth Dynamic GGUF quant is actually fastest ON THIS RIG.
//
// Why this exists: below a certain size, GGUF quants get SLOWER as they get smaller.
// The IQ1_*/IQ2_XXS/IQ2_XS formats are codebook-based and cost more GPU compute to
// unpack than they save in memory traffic, so the speed curve rises, peaks, then falls
// again once files get big enough to be bandwidth-bound. Where that peak sits depends on
// the card's compute:bandwidth ratio AND on how much VRAM it has, so it can only be found
// by measuring per rig. (Measured on an RTX PRO 6000: IQ2_S 113.8 < Q2_K_XL 142.3 <
// IQ3_XXS 149.8 > Q4_K_XL 132.3 tok/s.)
//
// The single most important thing this records is the `processor` field from `ollama ps`.
// If it is not "100% GPU" the model spilled to CPU and every timing for it is meaningless
// — that is the offload cliff, and it dwarfs every other effect measured here.
//
// Zero dependencies: Node >= 20 built-ins only. Needs `ollama` on PATH and (optionally)
// `nvidia-smi` for GPU telemetry.
//
//   node quantbench.mjs                     # auto-pick quants that fit this GPU
//   node quantbench.mjs --dry-run           # show the plan + download size, change nothing
//   node quantbench.mjs --quants UD-Q2_K_XL,UD-IQ3_XXS
//   node quantbench.mjs --ctx 32768 --max-tokens 400 --repeats 3
//   node quantbench.mjs --no-mtp            # disable draft_num_predict (MTP speculative decoding)
//
// Writes results/<host>-<gpu>-<timestamp>.json (full data incl. every answer) and .md
// (human summary + answers grouped by prompt for side-by-side quality comparison).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const OLLAMA = 'http://127.0.0.1:11434';

// ---------------------------------------------------------------- quant ladder
// File sizes from huggingface.co/unsloth/Qwen3.8-27B-GGUF (GB, as HF reports them).
// LOADED_EXTRA_GB is the observed gap between file size and what `ollama ps` reports
// resident: the vision projector (mmproj ~0.9GB) plus KV and runtime overhead. Used
// only to PREDICT what is worth downloading — actual fit is decided by `ollama ps`.
const LADDER = [
    { q: 'UD-IQ1_S', gb: 6.19 },
    { q: 'UD-IQ1_M', gb: 6.73 },
    { q: 'UD-IQ2_XXS', gb: 7.27 },
    { q: 'UD-IQ2_S', gb: 8.37 },
    { q: 'UD-Q2_K_XL', gb: 9.83 },
    { q: 'UD-IQ3_XXS', gb: 10.9 },
    { q: 'UD-IQ3_S', gb: 12.0 },
    { q: 'UD-Q3_K_XL', gb: 13.1 },
    { q: 'UD-IQ4_XS', gb: 14.3 },
    { q: 'UD-Q4_K_S', gb: 15.4 },
    { q: 'UD-Q4_K_M', gb: 16.5 },
    { q: 'UD-Q4_K_XL', gb: 17.6 },
    { q: 'UD-Q5_K_XL', gb: 20.9 },
    { q: 'UD-Q6_K_XL', gb: 25.3 },
    { q: 'UD-Q8_K_XL', gb: 31.5 },
];
const LOADED_EXTRA_GB = 1.2;    // mmproj + KV + runtime, at ctx 8192
// VRAM the OS/desktop/compositor holds and Ollama will not touch. 1.8 GB is
// CALIBRATED against measured spills, not guessed — with this value the fit rule
// below predicts all four observed outcomes correctly:
//   3070   8GB : IQ1_S     6.19+1.2=7.39 > 6.2  -> spilled (26%/74% CPU/GPU)  OK
//   4070Ti 12GB: IQ1_M     6.73+1.2=7.93 < 10.2 -> 100% GPU                   OK
//   4070Ti 12GB: IQ2_S     8.37+1.2=9.57 < 10.2 -> 100% GPU                   OK
//   4070Ti 12GB: Q2_K_XL   9.83+1.2=11.0 > 10.2 -> spilled (24%/76% CPU/GPU)  OK
// A Windows desktop with a browser open is the expensive case; a headless Linux
// box gets more, so pass --vram to override upward there.
const DESKTOP_RESERVE_GB = 1.8;

// ------------------------------------------------------------------- prompts
// Short and varied: speed is comparable across quants only if the work is identical,
// and answer QUALITY across quants is the other half of the evaluation.
const PROMPTS = [
    { id: 'science', text: 'Explain in about 150 words why the sky is blue.' },
    { id: 'reasoning', text: 'A farmer has 17 sheep. All but 9 die. How many are left? Show your reasoning step by step, then give the final answer.' },
    { id: 'code', text: 'Write a Python function that returns the nth Fibonacci number using memoization. Include a short docstring. Code only, no explanation.' },
    { id: 'french', text: 'Explique en 150 mots environ le fonctionnement d une imprimante 3D a depot de filament.' },
    { id: 'format', text: 'List exactly 5 differences between TCP and UDP. One line each, no preamble, no conclusion.' },
];

// ---------------------------------------------------------------------- args
const A = process.argv.slice(2);
const has = (n) => A.includes(n);
const arg = (n, d) => {
    const i = A.indexOf(n);
    return i >= 0 && A[i + 1] !== undefined ? A[i + 1] : d;
};

const CFG = {
    repo: arg('--repo', 'hf.co/unsloth/Qwen3.8-27B-GGUF'),
    ctx: parseInt(arg('--ctx', '8192'), 10),
    maxTokens: parseInt(arg('--max-tokens', '300'), 10),
    repeats: parseInt(arg('--repeats', '2'), 10),
    maxQuants: parseInt(arg('--max-quants', '4'), 10),
    mtp: !has('--no-mtp'),
    thinking: has('--thinking'),
    dryRun: has('--dry-run'),
    cleanup: has('--cleanup'),
    quants: arg('--quants', null),
    vramGb: arg('--vram', null) ? parseFloat(arg('--vram', null)) : null,
};

const log = (s = '') => process.stdout.write(s + '\n');
const ESC = String.fromCharCode(27);
const bold = (s) => ESC + '[1m' + s + ESC + '[0m';
const dim = (s) => ESC + '[90m' + s + ESC + '[0m';
const warn = (s) => ESC + '[33m' + s + ESC + '[0m';

// ------------------------------------------------------------------- helpers
async function sh(cmd, args, timeoutMs = 0) {
    try {
        const { stdout } = await execFileP(cmd, args, {
            timeout: timeoutMs,
            maxBuffer: 32 * 1024 * 1024,
            windowsHide: true,
        });
        return String(stdout || '');
    } catch (e) {
        return e && e.stdout ? String(e.stdout) : null;
    }
}

async function detectRig() {
    const rig = {
        hostname: os.hostname(),
        platform: os.platform() + ' ' + os.release(),
        cpuCores: (os.cpus() || []).length,
        cpuModel: (os.cpus() || [{}])[0].model || 'unknown',
        ramGb: Math.round(os.totalmem() / 1024 ** 3),
        gpu: 'Unknown GPU',
        vramGb: 0,
        driver: null,
        ollamaVersion: null,
        node: process.version,
    };
    const smi = await sh('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader,nounits'], 8000);
    if (smi) {
        const parts = (smi.split(/\r?\n/)[0] || '').split(',').map((s) => (s || '').trim());
        if (parts[0]) {
            rig.gpu = parts[0];
            rig.vramGb = Math.round(((Number(parts[1]) || 0) / 1024) * 10) / 10;
            rig.driver = parts[2] || null;
        }
    }
    const ov = await sh('ollama', ['--version'], 8000);
    if (ov) rig.ollamaVersion = ov.trim().split(/\s+/).pop();
    return rig;
}

// The offload detector. `ollama ps` prints e.g. "100% GPU" or "43%/57% CPU/GPU".
// Anything that is not 100% GPU means layers are on the CPU, and the timings below
// then measure PCIe and system RAM rather than the quant.
async function ollamaPs(modelName) {
    const out = await sh('ollama', ['ps'], 10000);
    if (!out) return { processor: null, sizeText: null, context: null, raw: null };
    const line = out.split(/\r?\n/).find((l) => l.startsWith(modelName));
    if (!line) return { processor: null, sizeText: null, context: null, raw: null };
    const proc = line.match(/(\d+%\s*\/\s*\d+%\s+CPU\/GPU|\d+%\s+GPU|\d+%\s+CPU)/i);
    const size = line.match(/\b(\d+(?:\.\d+)?\s*[KMGT]B)\b/i);
    const ctxAll = line.match(/\b\d{3,7}\b/g);
    return {
        processor: proc ? proc[1].replace(/\s+/g, ' ').trim() : null,
        sizeText: size ? size[1] : null,
        context: ctxAll ? parseInt(ctxAll[ctxAll.length - 1], 10) : null,
        raw: line.trim(),
    };
}

// Poll nvidia-smi during generation. Cheap (one exec per tick) and dependency-free.
class GpuSampler {
    constructor(intervalMs = 500) {
        this.intervalMs = intervalMs;
        this.samples = [];
        this.busy = false;
        this.t = null;
    }
    start() {
        this.t = setInterval(async () => {
            if (this.busy) return;
            this.busy = true;
            const out = await sh('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used', '--format=csv,noheader,nounits'], 3000);
            this.busy = false;
            if (!out) return;
            const p = (out.split(/\r?\n/)[0] || '').split(',').map((s) => Number((s || '').trim()));
            if (Number.isFinite(p[0]) && Number.isFinite(p[1])) this.samples.push({ util: p[0], vramMb: p[1] });
        }, this.intervalMs);
    }
    stop() {
        if (this.t) clearInterval(this.t);
        this.t = null;
    }
    summary() {
        if (!this.samples.length) return { n: 0, utilMean: null, utilMax: null, vramPeakGb: null, vramMeanGb: null };
        const us = this.samples.map((s) => s.util);
        const vs = this.samples.map((s) => s.vramMb);
        const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
        return {
            n: this.samples.length,
            utilMean: Math.round(mean(us)),
            utilMax: Math.max.apply(null, us),
            vramPeakGb: Math.round((Math.max.apply(null, vs) / 1024) * 100) / 100,
            vramMeanGb: Math.round((mean(vs) / 1024) * 100) / 100,
        };
    }
}

// One streaming completion. Captures timing AND the full answer text.
// Handles both `delta.reasoning` (Ollama) and `delta.reasoning_content` (llama.cpp).
async function runPrompt(model, prompt) {
    const t0 = Date.now();
    let ttft = null;
    let tokens = null;
    let chunks = 0;
    let content = '';
    let reasoning = '';

    const body = {
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: CFG.maxTokens,
        temperature: 0.7,
        top_p: 0.8,
        top_k: 20,
        min_p: 0.0,
    };
    if (!CFG.thinking) body.reasoning_effort = 'none';

    const res = await fetch(OLLAMA + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + (await res.text()).slice(0, 300));

    const rd = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            let o;
            try {
                o = JSON.parse(data);
            } catch {
                continue;
            }
            if (o.usage && o.usage.completion_tokens != null) tokens = o.usage.completion_tokens;
            const d = o.choices && o.choices[0] && o.choices[0].delta;
            if (!d) continue;
            const r = d.reasoning || d.reasoning_content || '';
            if (d.content) content += d.content;
            if (r) reasoning += r;
            if (d.content || r) {
                chunks++;
                if (ttft === null) ttft = Date.now() - t0;
            }
        }
    }
    const total = Date.now() - t0;
    const tok = tokens != null ? tokens : chunks;
    return {
        ttftMs: ttft === null ? total : ttft,
        totalMs: total,
        tokens: tok,
        tokPerSec: Math.round((tok / Math.max(0.001, (total - (ttft || 0)) / 1000)) * 10) / 10,
        answer: content,
        reasoning: reasoning || null,
    };
}

// --------------------------------------------------------------- per-quant run
async function benchQuant(quant) {
    const tag = CFG.repo + ':' + quant;
    const local = 'qb-' + quant.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const rec = { quant, tag, localModel: local, ok: false, error: null, runs: [], gpu: null, ps: null, fullGpu: false };

    log('\n' + bold('-- ' + quant));
    log(dim('   pulling ' + tag + ' (skipped if already present)'));
    if ((await sh('ollama', ['pull', tag], 0)) === null) {
        rec.error = 'pull failed';
        log('   ! pull failed');
        return rec;
    }

    // Rebuild the derived model every run so ctx/MTP always match the current flags.
    const mf = ['FROM ' + tag, 'PARAMETER num_ctx ' + CFG.ctx];
    if (CFG.mtp) mf.push('PARAMETER draft_num_predict 4'); // MTP speculative decoding
    const mfPath = join(HERE, '.Modelfile.' + local);
    writeFileSync(mfPath, mf.join('\n') + '\n', 'utf8');
    if ((await sh('ollama', ['create', local, '-f', mfPath], 0)) === null) {
        rec.error = 'ollama create failed';
        log('   ! create failed');
        return rec;
    }

    // Warm: the first request pays the model load. Never time that one.
    log(dim('   loading into VRAM ...'));
    try {
        await runPrompt(local, 'hi');
    } catch (e) {
        rec.error = 'warmup failed: ' + e.message;
        log('   ! ' + rec.error);
        return rec;
    }

    rec.ps = await ollamaPs(local);
    const resident = rec.ps.processor || 'unknown';
    rec.fullGpu = /^100%\s*GPU$/i.test(resident);
    log('   resident: ' + (rec.fullGpu ? bold(resident) : warn(resident + '  <-- SPILLED TO CPU, timings not comparable')));

    const sampler = new GpuSampler();
    sampler.start();
    for (let r = 0; r < CFG.repeats; r++) {
        for (const p of PROMPTS) {
            try {
                const out = await runPrompt(local, p.text);
                rec.runs.push(Object.assign({ promptId: p.id, repeat: r + 1 }, out));
                if (r === 0) {
                    log(dim('   ' + p.id.padEnd(10) + String(out.tokPerSec).padStart(7) + ' tok/s   ttft ' + (out.ttftMs / 1000).toFixed(2) + 's'));
                }
            } catch (e) {
                rec.runs.push({ promptId: p.id, repeat: r + 1, error: e.message });
                log('   ' + p.id + ': FAILED ' + e.message);
            }
        }
    }
    sampler.stop();
    rec.gpu = sampler.summary();

    const good = rec.runs.filter((x) => !x.error);
    if (good.length) {
        const tps = good.map((x) => x.tokPerSec).sort((a, b) => a - b);
        const ttf = good.map((x) => x.ttftMs).sort((a, b) => a - b);
        const med = (a) => a[Math.floor(a.length / 2)];
        rec.summary = {
            n: good.length,
            tokPerSecMedian: med(tps),
            tokPerSecMin: tps[0],
            tokPerSecMax: tps[tps.length - 1],
            ttftMedianMs: med(ttf),
            totalTokens: good.reduce((s, x) => s + x.tokens, 0),
        };
        rec.ok = true;
        log('   ' + bold(rec.summary.tokPerSecMedian + ' tok/s median') +
            ' - ttft ' + (rec.summary.ttftMedianMs / 1000).toFixed(2) + 's' +
            ' - GPU ' + rec.gpu.utilMean + '% avg' +
            ' - VRAM peak ' + rec.gpu.vramPeakGb + 'GB');
    }

    await sh('ollama', ['stop', local], 30000);
    return rec;
}

// ------------------------------------------------------------------- reporting
function toMarkdown(out) {
    const rig = out.rig;
    const cfg = out.config;
    const results = out.results;
    const L = [];

    L.push('# Quant ladder benchmark - ' + rig.gpu);
    L.push('');
    L.push('- **Rig**: ' + rig.hostname + ' - ' + rig.gpu + ' (' + rig.vramGb + ' GB) - ' + rig.cpuCores + ' cores - ' + rig.ramGb + ' GB RAM');
    L.push('- **Software**: Ollama ' + (rig.ollamaVersion || '?') + ' - driver ' + (rig.driver || '?') + ' - Node ' + rig.node + ' - ' + rig.platform);
    L.push('- **Settings**: repo `' + cfg.repo + '` - ctx ' + cfg.ctx + ' - max_tokens ' + cfg.maxTokens + ' - repeats ' + cfg.repeats + ' - MTP ' + (cfg.mtp ? 'on' : 'off') + ' - thinking ' + (cfg.thinking ? 'on' : 'off'));
    L.push('- **Run**: ' + out.startedAt);
    L.push('');
    L.push('## Speed');
    L.push('');
    L.push('| Quant | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util avg | VRAM peak |');
    L.push('|---|---|---|---|---|---|---|---|');
    for (const r of results) {
        if (!r.ok) {
            L.push('| ' + r.quant + ' | - | - | **failed** | ' + (r.error || '') + ' | | | |');
            continue;
        }
        L.push('| ' + r.quant +
            ' | ' + (r.ps.sizeText || '?') +
            ' | ' + (r.fullGpu ? 'yes' : '**NO - spilled**') +
            ' | **' + r.summary.tokPerSecMedian + '**' +
            ' | ' + r.summary.tokPerSecMin + '-' + r.summary.tokPerSecMax +
            ' | ' + (r.summary.ttftMedianMs / 1000).toFixed(2) + 's' +
            ' | ' + r.gpu.utilMean + '%' +
            ' | ' + r.gpu.vramPeakGb + ' GB |');
    }
    L.push('');

    const spilled = results.filter((r) => r.ok && !r.fullGpu);
    if (spilled.length) {
        L.push('> **Warning:** ' + spilled.map((r) => r.quant).join(', ') + ' did not fit fully in VRAM. Those numbers measure CPU offload, not the quant - exclude them when picking a winner.');
        L.push('');
    }
    const winner = results.filter((r) => r.ok && r.fullGpu).sort((a, b) => b.summary.tokPerSecMedian - a.summary.tokPerSecMedian)[0];
    if (winner) {
        L.push('**Fastest quant that fully fits: `' + winner.quant + '` at ' + winner.summary.tokPerSecMedian + ' tok/s.**');
        L.push('');
    }

    L.push('## Answers - grouped by prompt for side-by-side quality comparison');
    L.push('');
    for (const p of cfg.prompts) {
        L.push('### ' + p.id);
        L.push('');
        L.push('> ' + p.text);
        L.push('');
        for (const r of results) {
            if (!r.ok) continue;
            const first = r.runs.find((x) => x.promptId === p.id && !x.error);
            if (!first) continue;
            L.push('**' + r.quant + '** - ' + first.tokPerSec + ' tok/s, ' + first.tokens + ' tokens');
            L.push('');
            // Four-backtick fences: answers routinely CONTAIN triple-backtick code
            // blocks, which would close a three-backtick fence early and mangle the
            // whole report.
            if (first.reasoning) {
                L.push('<details><summary>reasoning</summary>');
                L.push('');
                L.push('````');
                L.push(first.reasoning.trim());
                L.push('````');
                L.push('');
                L.push('</details>');
                L.push('');
            }
            L.push('````');
            L.push((first.answer || '(empty)').trim());
            L.push('````');
            L.push('');
        }
    }
    return L.join('\n');
}

// ------------------------------------------------------------------------ main
(async () => {
    log(bold('quantbench - Unsloth Dynamic GGUF quant ladder'));
    const rig = await detectRig();
    log('  ' + rig.gpu + ' - ' + rig.vramGb + ' GB VRAM - ' + rig.cpuCores + ' cores - ' + rig.ramGb + ' GB RAM');
    log('  Ollama ' + (rig.ollamaVersion || dim('NOT FOUND')) + ' - driver ' + (rig.driver || '?'));

    if (!rig.ollamaVersion) {
        log('\n! `ollama` not found on PATH. Install from https://ollama.com and retry.');
        process.exit(1);
    }
    try {
        const r = await fetch(OLLAMA + '/api/version');
        if (!r.ok) throw new Error('bad status');
    } catch {
        log('\n! Ollama is not responding at ' + OLLAMA + '. Start it (`ollama serve`) and retry.');
        process.exit(1);
    }

    const vram = CFG.vramGb || rig.vramGb;
    if (!vram) {
        log('\n! Could not detect VRAM. Pass --vram <GB> explicitly.');
        process.exit(1);
    }

    // Candidate selection: everything predicted to fit, then the largest N of those.
    // Deliberately includes one rung likely to be marginal - a measured spill is a
    // RESULT (it locates the cliff on this card), not a failure.
    let picked;
    if (CFG.quants) {
        picked = CFG.quants.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
        const budget = vram - DESKTOP_RESERVE_GB;
        const fits = LADDER.filter((e) => e.gb + LOADED_EXTRA_GB <= budget + 0.6);
        picked = fits.slice(-CFG.maxQuants).map((e) => e.q);
    }
    if (!picked.length) {
        log('\n! No quant of ' + CFG.repo + ' fits in ' + vram + ' GB.');
        log('  Even the smallest rung (' + LADDER[0].q + ', ' + LADDER[0].gb + ' GB) needs about ' +
            (LADDER[0].gb + LOADED_EXTRA_GB).toFixed(1) + ' GB resident, and this card can offer ~' +
            (vram - DESKTOP_RESERVE_GB).toFixed(1) + ' GB.');
        log('  Measured on an RTX 3070 (8 GB): it loads but runs 26%/74% CPU/GPU at 8.4 tok/s -- unusable.');
        log('  This tier needs a SMALLER MODEL, not a smaller quant. Try --repo with a 12B-class');
        log('  model at a mid quant, which will be both faster and more accurate than a spilled 27B.');
        log('  To measure the spill anyway: --quants ' + LADDER[0].q);
        process.exit(1);
    }

    const sizeOf = (q) => (LADDER.find((e) => e.q === q) || {}).gb || 0;
    const totalGb = picked.reduce((s, q) => s + sizeOf(q), 0);
    log('\n  Plan: ' + bold(picked.join(', ')));
    log('  Download if absent: ~' + totalGb.toFixed(1) + ' GB - ' + PROMPTS.length + ' prompts x ' + CFG.repeats + ' repeats x ' + picked.length + ' quants');
    log('  ctx ' + CFG.ctx + ' - max_tokens ' + CFG.maxTokens + ' - MTP ' + (CFG.mtp ? 'on' : 'off') + ' - thinking ' + (CFG.thinking ? 'on' : 'off'));
    if (CFG.dryRun) {
        log('\n  --dry-run: nothing downloaded or changed.');
        process.exit(0);
    }

    const startedAt = new Date().toISOString();
    const results = [];
    for (const q of picked) results.push(await benchQuant(q));

    const out = {
        startedAt,
        finishedAt: new Date().toISOString(),
        rig,
        config: Object.assign({}, CFG, { prompts: PROMPTS }),
        results,
    };
    const dir = join(HERE, 'results');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const slug = (rig.hostname + '-' + rig.gpu).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const stamp = startedAt.replace(/[:.]/g, '-').slice(0, 19);
    const base = join(dir, slug + '-' + stamp);
    writeFileSync(base + '.json', JSON.stringify(out, null, 2), 'utf8');
    writeFileSync(base + '.md', toMarkdown(out), 'utf8');

    log('\n' + bold('Done.'));
    const ok = results.filter((r) => r.ok && r.fullGpu).sort((a, b) => b.summary.tokPerSecMedian - a.summary.tokPerSecMedian);
    if (ok.length) log('  Fastest fully-resident quant: ' + bold(ok[0].quant) + ' @ ' + ok[0].summary.tokPerSecMedian + ' tok/s');
    const bad = results.filter((r) => r.ok && !r.fullGpu);
    if (bad.length) log('  Spilled to CPU (excluded): ' + bad.map((r) => r.quant).join(', '));
    log('  ' + base + '.md');
    log('  ' + base + '.json');

    if (CFG.cleanup) {
        for (const r of results) await sh('ollama', ['rm', r.localModel], 60000);
        log(dim('  removed derived qb-* models (pulled quants kept)'));
    } else {
        log(dim('  cleanup: ollama rm ' + results.map((r) => r.localModel).join(' ')));
    }
})().catch((e) => {
    console.error('\nquantbench failed:', e);
    process.exit(1);
});
