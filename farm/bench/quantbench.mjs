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
// Speed is comparable across quants only if the work is identical; answer QUALITY is
// the other half of the evaluation.
//
// The `quick` set turned out to be TOO EASY to discriminate low-bit quants — on a
// 4070 Ti every rung from IQ1_M to Q2_K_XL solved the sheep riddle and produced a
// sane TCP/UDP list. The `hard` set below is built to break damaged quants, and most
// of its prompts carry a `check()` so quality becomes a measured pass-rate rather
// than an impression. Known first casualties of aggressive quantization: multi-step
// arithmetic (errors compound), strict structured output, several simultaneous
// format constraints, precise factual recall, and non-English fluency.
const PROMPT_SETS = {
    quick: [
        { id: 'science', text: 'Explain in about 150 words why the sky is blue.' },
        { id: 'reasoning', text: 'A farmer has 17 sheep. All but 9 die. How many are left? Show your reasoning step by step, then give the final answer.' },
        { id: 'code', text: 'Write a Python function that returns the nth Fibonacci number using memoization. Include a short docstring. Code only, no explanation.' },
        { id: 'french', text: 'Explique en 150 mots environ le fonctionnement d une imprimante 3D a depot de filament.' },
        { id: 'format', text: 'List exactly 5 differences between TCP and UDP. One line each, no preamble, no conclusion.' },
    ],
    hard: [
        {
            // Errors compound across three sub-results, so a damaged quant rarely lands exactly.
            id: 'arith',
            text: 'Compute (47 * 83) - (19 * 23) + (1500 / 12). Show each intermediate result on one short line each, no LaTeX and no explanation. Put the final numeric answer alone on the last line.',
            check: (a) => ({ pass: /\b3589\b/.test(a), note: '3901-437+125=3589' }),
        },
        {
            // Strict structured output degrades early and is trivially verifiable.
            id: 'json',
            text: 'Return ONLY a JSON object. No markdown fence, no prose, no explanation. Exactly these keys: "name" (a string), "ports" (an array of exactly 3 integers), "active" (a boolean).',
            check: (a) => {
                const s = a.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
                try {
                    const o = JSON.parse(s);
                    const ok = o && typeof o.name === 'string'
                        && Array.isArray(o.ports) && o.ports.length === 3 && o.ports.every((n) => Number.isInteger(n))
                        && typeof o.active === 'boolean';
                    return { pass: !!ok, note: ok ? 'valid' : 'parsed but wrong shape' };
                } catch {
                    return { pass: false, note: 'not parseable JSON' };
                }
            },
        },
        {
            // Four simultaneous constraints. Low-bit quants typically satisfy 2-3 of them.
            id: 'constraints',
            text: 'Write exactly 4 lines. Line 1 must start with the letter A, line 2 with B, line 3 with C, line 4 with D. Each line must be fewer than 40 characters. Use no punctuation anywhere. Output only the 4 lines.',
            check: (a) => {
                const lines = a.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
                if (lines.length !== 4) return { pass: false, note: lines.length + ' lines, expected 4' };
                const letters = ['A', 'B', 'C', 'D'];
                for (let i = 0; i < 4; i++) {
                    if (!lines[i].toUpperCase().startsWith(letters[i])) return { pass: false, note: 'line ' + (i + 1) + ' does not start with ' + letters[i] };
                    if (lines[i].length >= 40) return { pass: false, note: 'line ' + (i + 1) + ' is ' + lines[i].length + ' chars' };
                    if (/[.,;:!?'"()\-]/.test(lines[i])) return { pass: false, note: 'punctuation on line ' + (i + 1) };
                }
                return { pass: true, note: 'all 4 constraints held' };
            },
        },
        {
            // Precise recall — damaged weights blur specific numbers first.
            id: 'recall',
            text: 'What is the default TCP port for PostgreSQL, and what is the default TCP port for Redis? Answer with just the two numbers separated by a comma, nothing else.',
            check: (a) => {
                const pg = /\b5432\b/.test(a), rd = /\b6379\b/.test(a);
                return { pass: pg && rd, note: (pg ? '' : 'missing 5432 ') + (rd ? '' : 'missing 6379') || 'both correct' };
            },
        },
        {
            // Non-English fluency degrades before English does, and this fleet is French.
            id: 'french',
            text: "Explique en francais, en 120 mots environ, la difference entre la memoire VRAM et la memoire RAM systeme pour l inference d un modele de langage. Reponds uniquement en francais.",
            check: (a) => {
                const markers = (a.toLowerCase().match(/\b(le|la|les|des|une|est|pour|dans|avec|que|qui|plus|sur|cette|donc)\b/g) || []).length;
                return { pass: markers >= 6, note: markers + ' french markers' };
            },
        },
        {
            // Edge-case handling. Structural check only — model-generated code is never executed.
            id: 'code-edge',
            text: "Write a Python function parse_range(s) that returns [3,4,5,6,7] for '3-7', returns [5] for '5', and raises ValueError for anything else. Code only, no explanation.",
            check: (a) => {
                const hasDef = /def\s+parse_range\s*\(/.test(a);
                const hasErr = /ValueError/.test(a);
                const hasRange = /range\s*\(/.test(a);
                const n = [hasDef, hasErr, hasRange].filter(Boolean).length;
                return { pass: n === 3, note: n + '/3 structural markers (def, ValueError, range)' };
            },
        },
    ],
};

// ---------------------------------------------------------------------- args
const A = process.argv.slice(2);
const has = (n) => A.includes(n);
const arg = (n, d) => {
    const i = A.indexOf(n);
    return i >= 0 && A[i + 1] !== undefined ? A[i + 1] : d;
};

// --ctx and --mtp accept COMMA-SEPARATED LISTS, and the run sweeps their cross product
// with the quant list. That matters because on a tight card the answer to "which quant"
// changes with context (KV eats the headroom) and with MTP (the draft head costs VRAM
// but buys throughput) — those are not independent knobs, so they have to be swept, not
// assumed.
const parseCtxList = (s) => String(s).split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
const parseMtpList = (s) => String(s).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).map((x) => x === 'on' || x === 'true' || x === '1');

// The `hard` prompts are answered far more verbosely (step-by-step arithmetic in
// LaTeX, etc.), so they need a bigger token budget than `quick` or answers get cut
// off mid-derivation and the graders see truncation rather than capability.
const promptSet = arg('--prompts', 'quick');
const defaultMaxTokens = promptSet === 'quick' ? '300' : '700';

const CFG = {
    repo: arg('--repo', 'hf.co/unsloth/Qwen3.8-27B-GGUF'),
    ctxList: parseCtxList(arg('--ctx', '8192')),
    maxTokens: parseInt(arg('--max-tokens', defaultMaxTokens), 10),
    repeats: parseInt(arg('--repeats', '2'), 10),
    maxQuants: parseInt(arg('--max-quants', '4'), 10),
    mtpList: has('--no-mtp') ? [false] : parseMtpList(arg('--mtp', 'on')),
    promptSet,
    thinking: has('--thinking'),
    dryRun: has('--dry-run'),
    cleanup: has('--cleanup'),
    quants: arg('--quants', null),
    vramGb: arg('--vram', null) ? parseFloat(arg('--vram', null)) : null,
};

if (!CFG.ctxList.length) CFG.ctxList = [8192];
if (!CFG.mtpList.length) CFG.mtpList = [true];

const PROMPTS = CFG.promptSet === 'all'
    ? PROMPT_SETS.quick.concat(PROMPT_SETS.hard)
    : (PROMPT_SETS[CFG.promptSet] || PROMPT_SETS.quick);
// Functions do not survive JSON, so persist prompts as plain data.
const PROMPTS_META = PROMPTS.map((p) => ({ id: p.id, text: p.text, graded: typeof p.check === 'function' }));

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
        // Hitting the cap means the answer was cut off mid-thought. A grader must not
        // score that as WRONG — the model may have been on its way to the right answer
        // (observed: correct intermediates 3901/437/125/3464, truncated before "3589").
        // Otherwise verbose configs get penalised for being verbose, not for being wrong.
        truncated: tok >= CFG.maxTokens,
        tokPerSec: Math.round((tok / Math.max(0.001, (total - (ttft || 0)) / 1000)) * 10) / 10,
        answer: content,
        reasoning: reasoning || null,
    };
}

// --------------------------------------------------------------- per-quant run
async function benchQuant(quant, ctx, mtp) {
    const tag = CFG.repo + ':' + quant;
    // The local name encodes ctx and MTP so sweeping never reuses a stale build.
    const local = 'qb-' + quant.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-c' + ctx + (mtp ? '-mtp' : '-nomtp');
    const label = quant + '  [ctx ' + ctx + ', MTP ' + (mtp ? 'on' : 'off') + ']';
    const rec = { quant, ctx, mtp, tag, localModel: local, ok: false, error: null, runs: [], gpu: null, ps: null, fullGpu: false };

    log('\n' + bold('-- ' + label));
    log(dim('   pulling ' + tag + ' (skipped if already present)'));
    if ((await sh('ollama', ['pull', tag], 0)) === null) {
        rec.error = 'pull failed';
        log('   ! pull failed');
        return rec;
    }

    // Rebuild the derived model every run so ctx/MTP always match this sweep point.
    const mf = ['FROM ' + tag, 'PARAMETER num_ctx ' + ctx];
    if (mtp) mf.push('PARAMETER draft_num_predict 4'); // MTP speculative decoding
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
                // Grade objectively where the prompt defines a check. A guard around
                // check() keeps a thrown matcher from killing the whole sweep.
                let graded = null;
                if (typeof p.check === 'function') {
                    try { graded = p.check(out.answer || ''); }
                    catch (e) { graded = { pass: false, note: 'check threw: ' + e.message }; }
                    // A failure on a truncated answer is INCONCLUSIVE, not a failure:
                    // pass=null drops it from the score instead of counting against it.
                    if (!graded.pass && out.truncated) graded = { pass: null, note: 'inconclusive: hit max_tokens (' + out.tokens + ')' };
                }
                rec.runs.push(Object.assign({ promptId: p.id, repeat: r + 1 }, out, graded ? { pass: graded.pass, checkNote: graded.note } : {}));
                if (r === 0) {
                    const mark = !graded ? '' : graded.pass === null ? '  ????' : graded.pass ? '  PASS' : '  FAIL';
                    log(dim('   ' + p.id.padEnd(12) + String(out.tokPerSec).padStart(7) + ' tok/s   ttft ' + (out.ttftMs / 1000).toFixed(2) + 's' + mark));
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
        // Throughput from a handful of tokens is meaningless: with TTFT ~0.5s, a 2-token
        // answer computes as ~2 tok/s while the model is genuinely running at ~51. Observed
        // on `arith`, which sometimes replies with just a number. Rates are therefore taken
        // only from answers long enough to actually measure; short ones still count for
        // QUALITY, they just do not distort the speed figure.
        const RATE_MIN_TOKENS = 20;
        const forRate = good.filter((x) => x.tokens >= RATE_MIN_TOKENS);
        const rateRuns = forRate.length ? forRate : good;
        rec.shortAnswers = good.length - forRate.length;

        const tps = rateRuns.map((x) => x.tokPerSec).sort((a, b) => a - b);
        const ttf = good.map((x) => x.ttftMs).sort((a, b) => a - b);
        const med = (a) => a[Math.floor(a.length / 2)];
        const scored = good.filter((x) => x.pass === true || x.pass === false);
        const inconclusive = good.filter((x) => x.pass === null).length;
        rec.summary = {
            n: good.length,
            tokPerSecMedian: med(tps),
            tokPerSecMin: tps[0],
            tokPerSecMax: tps[tps.length - 1],
            ttftMedianMs: med(ttf),
            totalTokens: good.reduce((s, x) => s + x.tokens, 0),
            // Quality as a measured pass-rate over every graded attempt, not an impression.
            graded: scored.length,
            passed: scored.filter((x) => x.pass).length,
            inconclusive,
            scorePct: scored.length ? Math.round((scored.filter((x) => x.pass).length / scored.length) * 100) : null,
        };
        rec.ok = true;
        log('   ' + bold(rec.summary.tokPerSecMedian + ' tok/s median') +
            ' - ttft ' + (rec.summary.ttftMedianMs / 1000).toFixed(2) + 's' +
            ' - GPU ' + rec.gpu.utilMean + '% avg' +
            ' - VRAM peak ' + rec.gpu.vramPeakGb + 'GB' +
            (rec.summary.scorePct === null ? '' : ' - quality ' + bold(rec.summary.passed + '/' + rec.summary.graded) + ' (' + rec.summary.scorePct + '%)') +
            (rec.summary.inconclusive ? dim(' - ' + rec.summary.inconclusive + ' inconclusive (truncated)') : '') +
            (rec.shortAnswers ? dim(' - ' + rec.shortAnswers + ' short answer(s) excluded from rate') : ''));
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
    L.push('- **Settings**: repo `' + cfg.repo + '` - prompts `' + cfg.promptSet + '` - max_tokens ' + cfg.maxTokens + ' - repeats ' + cfg.repeats + ' - thinking ' + (cfg.thinking ? 'on' : 'off'));
    L.push('- **Sweep**: ctx ' + (cfg.ctxList || []).join(', ') + ' x MTP ' + (cfg.mtpList || []).map((m) => (m ? 'on' : 'off')).join(', '));
    L.push('- **Run**: ' + out.startedAt);
    L.push('');
    L.push('## Speed');
    L.push('');
    L.push('| Quant | ctx | MTP | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util | VRAM peak | Quality |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of results) {
        if (!r.ok) {
            L.push('| ' + r.quant + ' | ' + r.ctx + ' | ' + (r.mtp ? 'on' : 'off') + ' | - | - | **failed** | ' + (r.error || '') + ' | | | | |');
            continue;
        }
        L.push('| ' + r.quant +
            ' | ' + r.ctx +
            ' | ' + (r.mtp ? 'on' : 'off') +
            ' | ' + (r.ps.sizeText || '?') +
            ' | ' + (r.fullGpu ? 'yes' : '**NO - spilled**') +
            ' | **' + r.summary.tokPerSecMedian + '**' +
            ' | ' + r.summary.tokPerSecMin + '-' + r.summary.tokPerSecMax +
            ' | ' + (r.summary.ttftMedianMs / 1000).toFixed(2) + 's' +
            ' | ' + r.gpu.utilMean + '%' +
            ' | ' + r.gpu.vramPeakGb + ' GB' +
            ' | ' + (r.summary.scorePct === null ? '-' : r.summary.passed + '/' + r.summary.graded + ' (' + r.summary.scorePct + '%)') + ' |');
    }
    L.push('');

    // Per-prompt pass/fail grid: which capability each config actually loses.
    const gradedIds = (cfg.prompts || []).filter((p) => p.graded).map((p) => p.id);
    if (gradedIds.length && results.some((r) => r.ok && r.summary.graded)) {
        L.push('## Quality by prompt (pass rate over ' + cfg.repeats + ' repeats)');
        L.push('');
        L.push('| Config | ' + gradedIds.join(' | ') + ' | total |');
        L.push('|---|' + gradedIds.map(() => '---').join('|') + '|---|');
        for (const r of results) {
            if (!r.ok || !r.summary.graded) continue;
            const cells = gradedIds.map((id) => {
                const all = r.runs.filter((x) => x.promptId === id && 'pass' in x);
                const runs = all.filter((x) => x.pass === true || x.pass === false);
                const inc = all.filter((x) => x.pass === null).length;
                if (!runs.length) return inc ? '? x' + inc : '-';
                const p = runs.filter((x) => x.pass).length;
                return p + '/' + runs.length + (inc ? ' (+' + inc + '?)' : '');
            });
            L.push('| ' + r.quant + ' ctx' + r.ctx + ' mtp' + (r.mtp ? 'on' : 'off') + (r.fullGpu ? '' : ' **(spilled)**') +
                ' | ' + cells.join(' | ') + ' | **' + r.summary.scorePct + '%** |');
        }
        L.push('');
    }

    const spilled = results.filter((r) => r.ok && !r.fullGpu);
    if (spilled.length) {
        L.push('> **Warning:** ' + spilled.map((r) => r.quant).join(', ') + ' did not fit fully in VRAM. Those numbers measure CPU offload, not the quant - exclude them when picking a winner.');
        L.push('');
    }
    const winner = results.filter((r) => r.ok && r.fullGpu).sort((a, b) => b.summary.tokPerSecMedian - a.summary.tokPerSecMedian)[0];
    if (winner) {
        L.push('**Fastest config that fully fits: `' + winner.quant + '` at ctx ' + winner.ctx + ', MTP ' + (winner.mtp ? 'on' : 'off') +
            ' - ' + winner.summary.tokPerSecMedian + ' tok/s' +
            (winner.summary.scorePct === null ? '' : ', quality ' + winner.summary.scorePct + '%') + '.**');
        L.push('');
        L.push('> Fastest is not automatically best: check the quality column before choosing. A config that is 15% quicker but drops a graded capability is the wrong trade for an assistant.');
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
            const verdict = typeof first.pass === 'boolean' ? (first.pass ? ' - **PASS**' : ' - **FAIL** (' + (first.checkNote || '') + ')') : '';
            L.push('**' + r.quant + '** [ctx ' + r.ctx + ', MTP ' + (r.mtp ? 'on' : 'off') + ']' +
                ' - ' + first.tokPerSec + ' tok/s, ' + first.tokens + ' tokens' + verdict);
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
    const points = picked.length * CFG.ctxList.length * CFG.mtpList.length;
    const graded = PROMPTS.filter((p) => typeof p.check === 'function').length;
    log('\n  Plan: ' + bold(picked.join(', ')));
    log('  Sweep: ' + points + ' config(s) = ' + picked.length + ' quant x ' + CFG.ctxList.length + ' ctx (' + CFG.ctxList.join(', ') + ') x ' + CFG.mtpList.length + ' MTP (' + CFG.mtpList.map((m) => (m ? 'on' : 'off')).join(', ') + ')');
    log('  Download if absent: ~' + totalGb.toFixed(1) + ' GB - ' + PROMPTS.length + ' prompts (' + CFG.promptSet + ', ' + graded + ' graded) x ' + CFG.repeats + ' repeats');
    log('  max_tokens ' + CFG.maxTokens + ' - thinking ' + (CFG.thinking ? 'on' : 'off'));
    if (CFG.dryRun) {
        log('\n  --dry-run: nothing downloaded or changed.');
        process.exit(0);
    }

    const startedAt = new Date().toISOString();
    const results = [];
    for (const q of picked) {
        for (const ctx of CFG.ctxList) {
            for (const mtp of CFG.mtpList) {
                results.push(await benchQuant(q, ctx, mtp));
            }
        }
    }

    const out = {
        startedAt,
        finishedAt: new Date().toISOString(),
        rig,
        config: Object.assign({}, CFG, { prompts: PROMPTS_META }),
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
    if (ok.length) {
        log('  Fully-resident configs, fastest first:');
        for (const r of ok) {
            log('    ' + r.quant.padEnd(12) + 'ctx ' + String(r.ctx).padEnd(7) + 'MTP ' + (r.mtp ? 'on ' : 'off') +
                String(r.summary.tokPerSecMedian).padStart(8) + ' tok/s' +
                (r.summary.scorePct === null ? '' : '   quality ' + r.summary.passed + '/' + r.summary.graded + ' (' + r.summary.scorePct + '%)'));
        }
    }
    const bad = results.filter((r) => r.ok && !r.fullGpu);
    if (bad.length) log('  Spilled to CPU (excluded): ' + bad.map((r) => r.quant + '@ctx' + r.ctx).join(', '));
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
