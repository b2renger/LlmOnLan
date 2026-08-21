#!/usr/bin/env node
// summarize — collapse every results/*.json into one cross-rig table.
//
// Run after collecting results from several machines:
//   node summarize.mjs                 # all rigs, all quants
//   node summarize.mjs --md            # markdown (paste into an issue / doc)
//   node summarize.mjs --all           # include spilled rows (hidden by default)
//
// Rows that did not stay 100% GPU-resident are EXCLUDED by default: their timings
// measure CPU offload, not the quant, and mixing them into a comparison table is
// how you end up "concluding" that a bigger quant is slower.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'results');
const A = process.argv.slice(2);
const asMd = A.includes('--md');
const showAll = A.includes('--all');

let files;
try {
    files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
} catch {
    console.error('No results/ directory. Run quantbench.mjs first.');
    process.exit(1);
}
if (!files.length) {
    console.error('No result files in ' + DIR + '. Run quantbench.mjs first.');
    process.exit(1);
}

const rows = [];
const rigs = new Map();
for (const f of files) {
    let d;
    try {
        d = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    } catch (e) {
        console.error('skipping unreadable ' + f + ': ' + e.message);
        continue;
    }
    const rig = d.rig || {};
    const cfg = d.config || {};
    const key = rig.hostname + ' / ' + rig.gpu;
    if (!rigs.has(key)) rigs.set(key, { gpu: rig.gpu, vramGb: rig.vramGb, ram: rig.ramGb, ollama: rig.ollamaVersion, runs: 0 });
    rigs.get(key).runs++;
    for (const r of d.results || []) {
        if (!r.ok) continue;
        rows.push({
            rig: rig.hostname,
            gpu: rig.gpu,
            vramGb: rig.vramGb,
            quant: r.quant,
            resident: (r.ps && r.ps.sizeText) || '?',
            fullGpu: !!r.fullGpu,
            tps: r.summary ? r.summary.tokPerSecMedian : null,
            tpsMin: r.summary ? r.summary.tokPerSecMin : null,
            tpsMax: r.summary ? r.summary.tokPerSecMax : null,
            ttft: r.summary ? Math.round(r.summary.ttftMedianMs) : null,
            util: r.gpu ? r.gpu.utilMean : null,
            vramPeak: r.gpu ? r.gpu.vramPeakGb : null,
            // ctx/MTP moved from run-level config to per-result when sweeping landed.
            // Fall back to the old location so previously committed results still read.
            ctx: r.ctx != null ? r.ctx : cfg.ctx,
            mtp: r.mtp != null ? r.mtp : cfg.mtp,
            score: r.summary && r.summary.scorePct != null ? r.summary.scorePct : null,
            passed: r.summary ? r.summary.passed : null,
            graded: r.summary ? r.summary.graded : null,
            when: (d.startedAt || '').slice(0, 16).replace('T', ' '),
        });
    }
}

const shown = showAll ? rows : rows.filter((r) => r.fullGpu);
const hidden = rows.length - shown.length;

// Group by rig, and inside a rig order by speed so the winner is the top line.
shown.sort((a, b) => (a.rig === b.rig ? b.tps - a.tps : a.rig.localeCompare(b.rig)));

const H = ['Rig', 'GPU (VRAM)', 'Quant', 'ctx', 'MTP', 'Resident', 'GPU?', 'tok/s', 'range', 'TTFT', 'util', 'VRAM pk', 'quality'];
const fmt = (r) => [
    r.rig,
    r.gpu.replace(/^NVIDIA\s+/, '').replace(/\s+(Workstation Edition|Laptop GPU)$/, '') + ' (' + r.vramGb + 'GB)',
    r.quant,
    String(r.ctx),
    r.mtp ? 'on' : 'off',
    r.resident,
    r.fullGpu ? 'yes' : 'SPILLED',
    r.tps == null ? '?' : String(r.tps),
    r.tpsMin == null ? '?' : r.tpsMin + '-' + r.tpsMax,
    r.ttft == null ? '?' : (r.ttft / 1000).toFixed(2) + 's',
    r.util == null ? '?' : r.util + '%',
    r.vramPeak == null ? '?' : r.vramPeak + 'GB',
    r.score == null ? '-' : r.passed + '/' + r.graded + ' (' + r.score + '%)',
];

const table = shown.map(fmt);

if (asMd) {
    console.log('| ' + H.join(' | ') + ' |');
    console.log('|' + H.map(() => '---').join('|') + '|');
    for (const t of table) console.log('| ' + t.join(' | ') + ' |');
} else {
    const w = H.map((h, i) => Math.max(h.length, ...table.map((t) => t[i].length)));
    const line = (cells) => cells.map((c, i) => c.padEnd(w[i])).join('  ');
    console.log('');
    console.log(line(H));
    console.log(w.map((n) => '-'.repeat(n)).join('  '));
    let prev = null;
    for (const t of table) {
        if (prev !== null && t[0] !== prev) console.log('');
        console.log(line(t));
        prev = t[0];
    }
}

console.log('');
console.log(files.length + ' result file(s) across ' + rigs.size + ' rig(s).');
if (hidden) console.log(hidden + ' row(s) hidden because the model spilled to CPU (--all to show).');

// Per-rig recommendation: what each box should actually serve.
//
// Ranked on QUALITY FIRST, speed only as the tie-break. Ranking on speed alone
// recommended UD-IQ1_S on the 4070 Ti at 58 tok/s — the single worst option
// measured (63% pooled; it loses code generation entirely, 0/3). The fastest quant
// is routinely the most damaged one, so a speed-only headline actively misleads.
//
// Quality is pooled GLOBALLY per quant, across every rig that ran it — the same
// GGUF produces the same output distribution on any card, so a 4070 Ti sample and
// a 96GB sample are samples of one thing. Pooling per rig instead let a single
// lucky 16/18 promote UD-IQ1_M above UD-IQ2_XXS on one box, when its pooled score
// across both machines is 81% vs 90%. That matters because one n=3 pass swings by
// up to 17 points at temperature 0.7.
const qualityByQuant = new Map();
for (const r of rows) {           // includes spilled rows: spilling breaks speed, not correctness
    if (!r.graded) continue;
    const q = qualityByQuant.get(r.quant) || { passed: 0, graded: 0 };
    q.passed += r.passed; q.graded += r.graded;
    qualityByQuant.set(r.quant, q);
}
const scoreOf = (quant) => {
    const q = qualityByQuant.get(quant);
    return q && q.graded ? Math.round((q.passed / q.graded) * 100) : null;
};

// Speed is per (rig, quant) and must come from fully-resident rows only.
const byRigQuant = new Map();
for (const r of rows.filter((x) => x.fullGpu)) {
    const k = r.rig + '|' + r.quant;
    const cur = byRigQuant.get(k) || { rig: r.rig, quant: r.quant, best: r };
    if (r.tps > cur.best.tps) cur.best = r;
    byRigQuant.set(k, cur);
}
const byRig = new Map();
for (const c of byRigQuant.values()) {
    const q = qualityByQuant.get(c.quant);
    c.scorePct = scoreOf(c.quant);
    c.passed = q ? q.passed : null;
    c.graded = q ? q.graded : null;
    const prev = byRig.get(c.rig);
    if (!prev) { byRig.set(c.rig, c); continue; }
    // Quality wins outright; only a near-tie (<=5 points, within sampling noise at
    // n=3 and temperature 0.7) is broken by speed.
    const a = c.scorePct == null ? -1 : c.scorePct;
    const b = prev.scorePct == null ? -1 : prev.scorePct;
    if (a - b > 5 || (Math.abs(a - b) <= 5 && c.best.tps > prev.best.tps)) byRig.set(c.rig, c);
}
if (byRig.size) {
    console.log('');
    console.log('Recommended per rig (best quality; speed breaks ties within 5 points):');
    for (const [rig, c] of byRig) {
        console.log('  ' + rig.padEnd(16) + c.quant.padEnd(13) +
            String(c.best.tps).padStart(6) + ' tok/s  ctx ' + String(c.best.ctx).padEnd(7) +
            (c.scorePct == null ? 'quality not measured' : 'quality ' + c.passed + '/' + c.graded + ' (' + c.scorePct + '%)'));
    }
    console.log('  (speed-only ranking would pick the most damaged quant — see --all for every row)');
}
