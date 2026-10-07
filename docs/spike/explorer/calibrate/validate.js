// Validation of estimator.js against measured.json (both boxes) and the catalog's community single-user runs.
// Writes calibrate/validation_tables.md and prints a summary. Stages:
//  S0  previous method (ESTIMATES 2026-10-05): per-model PRO fits t = a + bN + kNC, scaled by bandwidth (decode) / compute (TTFT)
//  S1  physics, calibrated on the PRO 6000 only (no GB10 factors): out-of-sample on the Spark
//  S2  shipped constants (+ GB10 factors and per-model extra bytes from one single-user Spark decode)
//  G   shipped physics with the model treated as never measured (leave-one-model-out generic constants)
// S0/S1/S2/G use the spike's own block remainder (all users had the same context); "class" uses the explorer default.
const E = require('../../../../farm/src/capacity/estimator.js'), lstsq = require('./lsq.js'), fs = require('fs');
const cat = require('../../../../farm/src/capacity/catalog.json'), meas = require('../measured.json'), rows = require('./rows.json'), calib = require('./calibration.json');
E.init(cat, null);                         // no measured lookup: we want the model's own numbers
const I = E._internal;
const MODELS = { qwen36: 'qwen3.6-35b-a3b', nemotron: 'nemotron-3.5-lightning-30b-a3b', qwen38: 'qwen3.8-27b' };
const HWID = { pro6000: 'rtx-pro-6000-ws', spark: 'dgx-spark' };
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const f0 = x => (x == null ? '-' : Math.round(x).toString()), f1 = x => x.toFixed(1), pc = x => (x >= 0 ? '+' : '') + Math.round(100 * x) + '%';
const md = []; const say = s => { md.push(s); };

// ---- stage S0: the previous method
const bad = r => (r.box === 'pro6000' && r.model === 'qwen36' && r.prof === 'followup_128k_replace') || (r.model === 'qwen38' && r.prof === 'followup_32k_replace')
  || r.err > 0 || r.ttft95 > 30;
const fit = (k, rd, ycol, X) => { const rs = rows.filter(r => r.box === 'pro6000' && r.model === k && r.rd === rd && r.prof.startsWith('followup') && !bad(r) && r.N >= 4 && r.d10);
  return lstsq(rs.map(X), rs.map(ycol)); };
const S0 = {};
for (const k of Object.keys(MODELS)) S0[k] = { r2: fit(k, 'r2', r => 1 / r.d10, r => [1, r.N, r.N * r.C / 1e6]), r1: fit(k, 'r1', r => 1 / r.d10, r => [1, r.N, r.N * r.C / 1e6]),
  ttft: fit(k, 'r1', r => r.ttft95, r => [1, r.N * r.C / 1e6]) };
function peopleS0(box, k, C, poolGiB) {
  const bw = box === 'spark' ? 1792 / 273 : 1, cr = box === 'spark' ? 1000 / 250 : 1, s = S0[k];
  const step = (c, N) => (c[0] + c[1] * N + c[2] * N * C / 1e6) * bw, maxN = f => { let n = 0; while (n < 4096 && f(n + 1)) n++; return n; };
  const m = cat.models.find(x => x.id === MODELS[k]), lay = I.kvLayout(m, 'fp8');
  const kv = Math.floor(0.905 * poolGiB * 2 ** 30 / I.personBytes(lay, C + 256));
  const dec2 = maxN(N => step(s.r2, N) <= 1 / 15), dec1 = maxN(N => step(s.r1, N) <= 1 / 15), tt = maxN(N => (s.ttft[0] + s.ttft[1] * N * C / 1e6) * cr < 5);
  return { every: Math.min(dec1, tt, kv, dec2), steady: Math.min(dec2, kv) };
}
// ---- constants per stage
const FINAL = JSON.parse(JSON.stringify(E.CAL)), A0 = JSON.parse(JSON.stringify(E.ASSUME));
const setStage = st => { for (const id of Object.keys(FINAL)) E.CAL[id] = Object.assign({}, st === 'S1' ? calib.out.stage1[id] : FINAL[id]); };
const S1assume = { unifiedMemGain: 1, gb10PrefillEff: 1 };
function genericAssume(k) { // the model is treated as never measured: generic values from the two other models only
  const others = Object.keys(MODELS).filter(x => x !== k).map(x => FINAL[MODELS[x]]), moe = k !== 'qwen38';
  const st = mean(others.map(c => c.stepMs)), ex = moe ? FINAL[MODELS[k === 'qwen36' ? 'nemotron' : 'qwen36']].extraGB : 0;
  const lin = moe ? FINAL[MODELS[k === 'qwen36' ? 'nemotron' : 'qwen36']].effLin : 0.6, att = mean(others.map(c => c.effAttn));
  const loo = calib.out.loo[k];
  return { stepMs: [st + 0.75, st, st - 0.75], moeExtraGB: [ex + 0.5, ex, Math.max(0, ex - 0.5)], effLinMoE: [lin * 0.8, lin, lin * 1.2],
    effLinDense: [0.45, 0.6, 0.72], effAttn: [att * 0.85, att, att * 1.2], stateCost: loo.stateCost, kvEff: loo.kvEff, interleave: [loo.interleave * 1.05, loo.interleave, loo.interleave * 0.8] };
}
function predict(box, k, C, opts, stage) {
  setStage(stage === 'S1' ? 'S1' : 'S2'); const id = MODELS[k], saved = E.CAL[id];
  const o = Object.assign({ context: C, poolGiB: 58, replyTokens: 256, newTokens: 400, thinking: 1, kvDtype: 'fp8', budget: 'single_user' }, opts);
  if (stage === 'S1') o.assume = Object.assign({}, S1assume, o.assume);
  if (stage === 'G') { delete E.CAL[id]; o.assume = Object.assign(genericAssume(k), o.assume); }
  try { return E.estimate(HWID[box], id, o); } finally { E.CAL[id] = saved; setStage('S2'); }
}
const perr = (pred, r) => { const lo = r.pass || 0, hi = r.fail != null ? r.fail - 1 : Infinity;
  return pred < lo ? pred / lo - 1 : pred > hi ? pred / Math.max(hi, 1) - 1 : 0; };

// ---- A. people, every cell of both boxes
say('### A. People at once, predicted vs measured (vLLM, 58 GiB KV pool, fp8 KV, 256-token replies)\n');
say('Measured = the spike\'s label: `N` passed and the next tested level failed (true value in [N, next)), `≥ N` = highest tested passed, `< N` = lowest tested failed. ' +
  'Predictions are the central run. Error = distance to the measured interval (0 = inside). S0 = previous method, S1 = PRO-only physics, S2 = shipped, G = as if the model had never been measured. ' +
  '"class" = the explorer default (a class averages half a cache block re-computed per turn) with its low–high range.\n');
say('| Box | Model | Context | Mode | Measured | S0 | S1 | S2 | G | class (low–high) | binds (S2) |');
say('|---|---|---|---|---|---|---|---|---|---|---|');
const err = { S0: {}, S1: {}, S2: {}, G: {} }, cells = [];
for (const box of ['pro6000', 'spark']) for (const k of Object.keys(MODELS)) for (const ctx of ['32k', '64k', '128k']) {
  const cfg = meas.configs.find(c => c.id === box + '/vllm/' + k), p = cfg.people['followup_' + ctx];
  if (!p) continue;
  const lv = cfg.profiles[p.profile].levels, C = Math.round(mean(lv.map(l => l.prompt_tok))), m = cat.models.find(x => x.id === MODELS[k]);
  const lay = I.kvLayout(m, 'fp8'), miss = lay.block > 16 ? (C - 400) % lay.block : 0;
  const s0 = peopleS0(box, k, C, 58), r1 = predict(box, k, C, { cacheMissTokens: miss }, 'S1'), r2 = predict(box, k, C, { cacheMissTokens: miss }, 'S2');
  const g = predict(box, k, C, { cacheMissTokens: miss }, 'G'), cl = predict(box, k, C, {}, 'S2');
  for (const mode of ['every', 'steady']) {
    const r = p[mode]; if (!r) continue;
    const key = mode === 'every' ? 'peopleEvery' : 'peopleSteady', v = { S0: s0[mode], S1: r1[key].mid, S2: r2[key].mid, G: g[key].mid };
    for (const s of Object.keys(v)) (err[s][box] = err[s][box] || []).push(perr(v[s], r));
    cells.push({ box, k, ctx, mode, r, v, cl: cl[key] });
    const show = s => f0(v[s]) + (perr(v[s], r) ? ' (' + pc(perr(v[s], r)) + ')' : ' ✓');
    say(`| ${box} | ${k} | ${ctx} (${(C / 1000).toFixed(1)}k, miss ${miss}) | ${mode} | ${r.label} | ${show('S0')} | ${show('S1')} | ${show('S2')} | ${show('G')} | ${cl[key].mid} (${cl[key].low}–${cl[key].high}) | ${mode === 'every' ? r2.binding : r2.limits && (r2.limits['memory (KV)'] < r2.limits['decode bandwidth'] ? 'memory (KV)' : 'decode bandwidth')} |`);
  }
}
say('\n**Summary of people errors** (mean |error| / worst |error| / cells inside the measured interval):\n');
say('| Stage | PRO 6000 | Spark (out of sample for S0, S1) |'); say('|---|---|---|');
for (const s of ['S0', 'S1', 'S2', 'G']) say(`| ${s} | ${['pro6000', 'spark'].map(b => { const e = err[s][b]; return pc(mean(e.map(Math.abs))).replace('+', '') + ' / ' + pc(Math.max(...e.map(Math.abs))).replace('+', '') + ' / ' + e.filter(x => x === 0).length + ' of ' + e.length; }).join(' | ')} |`);
const overl = b => cells.filter(c => c.box === b).filter(c => { const lo = c.r.pass || 0, hi = c.r.fail != null ? c.r.fail - 1 : Infinity; return c.cl.high >= lo && c.cl.low <= hi; }).length;
say(`
The explorer's default ("class": half a cache block re-computed per turn) overlaps the measured interval with its low–high range in ${overl('pro6000')} of 18 PRO cells and ${overl('spark')} of 18 Spark cells.`);

// ---- B. single-user decode, measured boxes
say('\n### B. One person alone: decode tok/s, predicted vs measured\n');
say('| Box | Model | Context | Measured | S1 | S2 | G |'); say('|---|---|---|---|---|---|---|');
const eB = { S1: [], S2: [], G: [] };
for (const box of ['pro6000', 'spark']) for (const k of Object.keys(MODELS)) {
  const cfg = meas.configs.find(c => c.id === box + '/vllm/' + k);
  const pts = [['4k chat', cfg.single_user.chat.prompt_tok + 250, cfg.single_user.chat.decode_tps_p50]].concat(Object.entries(cfg.cold_prefill_single_user).map(([c, v]) => [c + ' cold', v.prompt_tok + 128, v.decode_tps_after]));
  for (const [lab, C, y] of pts) { const v = ['S1', 'S2', 'G'].map(s => predict(box, k, C, {}, s).singleUserTps.mid);
    ['S1', 'S2', 'G'].forEach((s, i) => eB[s].push(v[i] / y - 1));
    say(`| ${box} | ${k} | ${lab} | ${f1(y)} | ${v.map((x, i) => f1(x) + ' (' + pc(x / y - 1) + ')').join(' | ')} |`); }
}
say('\nMean |error|: ' + ['S1', 'S2', 'G'].map(s => s + ' ' + pc(mean(eB[s].map(Math.abs))).replace('+', '') + ' (worst ' + pc(Math.max(...eB[s].map(Math.abs))).replace('+', '') + ')').join(', ') + '.');

// ---- C. cold prompt time, measured boxes
say('\n### C. One person pastes the whole context (cold prefill), seconds\n');
say('| Box | Model | Context | Measured | S1 | S2 | G |'); say('|---|---|---|---|---|---|---|');
const eC = { S1: [], S2: [], G: [] };
for (const box of ['pro6000', 'spark']) for (const k of Object.keys(MODELS)) {
  const cfg = meas.configs.find(c => c.id === box + '/vllm/' + k);
  for (const [c, v] of Object.entries(cfg.cold_prefill_single_user)) { const pr = ['S1', 'S2', 'G'].map(s => predict(box, k, v.prompt_tok, {}, s).coldPromptS.mid);
    ['S1', 'S2', 'G'].forEach((s, i) => eC[s].push(pr[i] / v.ttft_p50_s - 1));
    say(`| ${box} | ${k} | ${c} | ${f1(v.ttft_p50_s)} | ${pr.map(x => f1(x) + ' (' + pc(x / v.ttft_p50_s - 1) + ')').join(' | ')} |`); }
}
say('\nMean |error|: ' + ['S1', 'S2', 'G'].map(s => s + ' ' + pc(mean(eC[s].map(Math.abs))).replace('+', '') + ' (worst ' + pc(Math.max(...eC[s].map(Math.abs))).replace('+', '') + ')').join(', ') + '. On the PRO, S1 = S2 = in-sample.');

// ---- D. models never measured: single-user decode reported by vendors / the community (catalog reported_runs)
say('\n### D. Models never measured by the studio: one person\'s decode tok/s vs reported runs (shipped constants, generic)\n');
say('| Model | Box | Checkpoint used | Reported (source, date) | Predicted mid (low–high) | Error vs reported mid |'); say('|---|---|---|---|---|---|');
const D = [
  ['gpt-oss-120b', 'dgx-spark', 'MXFP4 (native release)', [55.4, 60.4], 'NVIDIA blog 2025-10-24 llama.cpp 55.4; plan §9 vLLM 60.4'],
  ['gpt-oss-120b', 'dgx-spark-x2', 'MXFP4 (native release)', [75, 75], 'NVIDIA forum 2025-12, vLLM TP=2'],
  ['qwen3.5-122b-a10b', 'dgx-spark', 'NVFP4', [30, 30], 'NVIDIA forum 2026 spring, plain vLLM'],
  ['nemotron-3-super-120b-a12b', 'dgx-spark', 'NVFP4', [22.7, 23.7], 'vLLM blog 2026-06-01'],
  ['qwen3.8-flash-next', 'dgx-spark', 'NVFP4, n-gram table offloaded to NVMe (patched vLLM)', [41.7, 41.7], 'ai-muninn 2026-09-12'],
  ['qwen3.8-flash-next', 'dgx-spark-x2', 'NVFP4 (routed experts W4A4; attention + shared experts BF16; n-gram FP8)', [51.9, 51.9], 'ai-muninn 2026-09-12, vLLM TP=2'],
  ['qwen3.5-397b-a17b', 'dgx-spark-x2', 'int4 AutoRound', [26, 30.8], 'NVIDIA forum 2026-03 / 2026-07-03, vLLM TP=2'],
  ['minimax-m2.7', 'dgx-spark-x2', 'AWQ 4-bit', [40, 40], 'NVIDIA forum (search snippet), vLLM TP=2'],
  ['glm-5.3-flash', 'dgx-spark-x2', 'NVFP4', [14.7, 14.7], 'NVIDIA forum 2026-08-28, SGLang TP=2, no MTP'],
  ['deepseek-v4-flash-0731', 'dgx-spark-x2', 'FP8 attention + FP4 experts (official)', [41, 41], 'GitHub 2026-06, vLLM TP=2'],
  ['qwen3-coder-next', 'dgx-spark', 'GGUF UD-Q4_K_XL', [60.8, 60.8], 'plan §9 vLLM NVFP4 42.7 GiB (proxy: the 4-bit GGUF entry)'],
  ['ternary-bonsai-2-27b', 'rtx-5090', 'GGUF PQ2_0 (2-bit slots, 2.13 bpw)', [129.9, 129.9], 'PrismML model card, llama.cpp fork'],
  ['ternary-bonsai-2-27b', 'rtx-pro-6000-ws', 'GGUF PQ2_0 (2-bit slots, 2.13 bpw)', [124.8, 124.8], 'PrismML model card, llama.cpp fork'],
];
const eD = [];
for (const [mid, hw, ckf, rep, src] of D) {
  const m = cat.models.find(x => x.id === mid), ck = m.checkpoints.find(c => c.format.startsWith(ckf)) || m.checkpoints[0];
  const r = E.estimate(hw, mid, { context: 4096, budget: 'single_user', cluster: 'tp', checkpoint: ck.format });
  const ym = (rep[0] + rep[1]) / 2, e = r.singleUserTps.mid / ym - 1; eD.push(e);
  say(`| ${mid} | ${hw}${r.cluster === 'tp' ? ' (TP=2)' : ''} | ${ck.format} | ${rep[0] === rep[1] ? rep[0] : rep[0] + '–' + rep[1]} (${src}) | ${f1(r.singleUserTps.mid)} (${f1(r.singleUserTps.low)}–${f1(r.singleUserTps.high)})${r.fits ? '' : ' [does not fit]'} | ${pc(e)} |`);
}
say('\nMean |error| ' + pc(mean(eD.map(Math.abs))).replace('+', '') + ', worst ' + pc(Math.max(...eD.map(Math.abs))).replace('+', '') + ' (signed mean ' + pc(mean(eD)) + ').');

// ---- E. batched throughput on Sparks for models never measured (aggregate tok/s = N x per-person decode)
say('\n### E. Many people on Sparks, models never measured: aggregate decode tok/s at N users vs reported\n');
say('Reported runs give no context size; the check uses a 2k-token context and 256-token replies, steady state.\n');
say('| Model | Box | N | Reported aggregate tok/s (source) | Predicted mid (low–high) | Error |'); say('|---|---|---|---|---|---|');
const EE = [
  ['gpt-oss-120b', 'dgx-spark', 'MXFP4 (native release)', 8, 141.9, 'plan §9, vLLM'], ['gpt-oss-120b', 'dgx-spark', 'MXFP4 (native release)', 16, 181.2, 'plan §9, vLLM'],
  ['gpt-oss-120b', 'dgx-spark-x2', 'MXFP4 (native release)', 32, 292.5, 'NVIDIA forum 2025-12, vLLM TP=2 (SGLang 323)'],
  ['deepseek-v4-flash-0731', 'dgx-spark-x2', 'FP8 attention + FP4 experts (official)', 32, 350, 'GitHub 2026-06, vLLM TP=2'],
  ['glm-5.3-flash', 'dgx-spark-x2', 'NVFP4', 8, 55.1, 'NVIDIA forum 2026-08-28, SGLang TP=2 (78 with fp8 KV)'],
];
const eE = [];
for (const [mid, hw, ckf, N, rep, src] of EE) {
  const m = cat.models.find(x => x.id === mid), ck = m.checkpoints.find(c => c.format.startsWith(ckf));
  const runs = [0, 1, 2].map(run => { const o = { context: 2048, budget: 'single_user', cluster: 'tp', checkpoint: ck.format };
    const r = E.estimate(hw, mid, o), H = I.resolveHw(hw), lay = I.kvLayout(m, 'fp8'), P = I.physics(H, m, r.checkpoint, lay, run, r.cluster);
    const tau = I.turnS(P, 400 + (lay.block > 16 ? [0.9, 0.5, 0.1][run] * lay.block : 0), 2048);
    return N / I.stepS(P, lay, N, 2048 + 128, (N - 1) * tau / 256); });
  const e = runs[1] / rep - 1; eE.push(e);
  say(`| ${mid} | ${hw} | ${N} | ${rep} (${src}) | ${f0(runs[1])} (${f0(runs[0])}–${f0(runs[2])}) | ${pc(e)} |`);
}
say('\nMean |error| ' + pc(mean(eE.map(Math.abs))).replace('+', '') + ' (signed ' + pc(mean(eE)) + ').');
fs.writeFileSync(__dirname + '/validation_tables.md', md.join('\n') + '\n');
console.log(md.join('\n'));
