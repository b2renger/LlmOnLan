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

// Per-rig winner: the fastest quant that stayed fully resident. This is the
// actual deliverable — what each box should serve.
const byRig = new Map();
for (const r of rows.filter((x) => x.fullGpu)) {
    if (!byRig.has(r.rig) || byRig.get(r.rig).tps < r.tps) byRig.set(r.rig, r);
}
if (byRig.size) {
    console.log('');
    console.log('Fastest fully-resident quant per rig:');
    for (const [rig, r] of byRig) {
        console.log('  ' + rig.padEnd(16) + r.quant.padEnd(13) + r.tps + ' tok/s  (ctx ' + r.ctx + ', MTP ' + (r.mtp ? 'on' : 'off') + ')');
    }
}
