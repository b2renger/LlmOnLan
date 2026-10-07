// Fits estimator.js's constants from measured.json (run: node calibrate/calibrate.js; writes calibrate/calibration.json).
// Stage 1 = the PRO 6000 only. Stage 2 = + GB10 platform factors and per-model extra bytes from ONE single-user
// Spark decode. Leave-one-model-out (LOO) lines show how a factor fitted without a model predicts that model.
const E = require('../../../../farm/src/capacity/estimator.js'), lstsq = require('./lsq.js');
const cat = require('../../../../farm/src/capacity/catalog.json'), meas = require('../measured.json'), rows = require('./rows.json');
E.init(cat, null);
const I = E._internal, MODELS = { qwen36: 'qwen3.6-35b-a3b', nemotron: 'nemotron-3.5-lightning-30b-a3b', qwen38: 'qwen3.8-27b' };
const HWID = { pro6000: 'rtx-pro-6000-ws', spark: 'dgx-spark' }, ks = Object.keys(MODELS);
const model = k => cat.models.find(m => m.id === MODELS[k]);
const cfg = (box, k) => meas.configs.find(c => c.id === box + '/vllm/' + k);
const ck = k => I.pickCheckpoint(model(k), 999, 0);  // the measured (loaded) checkpoint
const lay = k => I.kvLayout(model(k), 'fp8');
const P = (box, k) => I.physics(I.resolveHw(HWID[box]), model(k), ck(k), lay(k), 1, 'single');
const bad = r => (r.box === 'pro6000' && r.model === 'qwen36' && r.prof === 'followup_128k_replace') || (r.model === 'qwen38' && r.prof === 'followup_32k_replace')
  || (r.box === 'spark' && r.prof === 'followup_128k_replace' && r.model === 'qwen36') || r.err > 0 || r.ttft95 > 30;
const fu = (box, rd, k) => rows.filter(r => r.box === box && r.rd === rd && r.model === k && r.prof.startsWith('followup') && !bad(r) && r.N >= 2 && r.d10);
const miss = (L, C) => (L.block > 16 ? (C - 400) % L.block : 0);   // the spike's users all shared this remainder
const out = {}, pct = x => (100 * x).toFixed(1) + '%', mean = a => a.reduce((s, x) => s + x, 0) / a.length;

// ---- 1. cold prefill: T = C*lin + C^2/2*pair -> effLin, effAttn (vs FP8 dense TFLOPS); GB10 ratio
const cold = {};
for (const box of ['pro6000', 'spark']) for (const k of ks) {
  const pts = Object.values(cfg(box, k).cold_prefill_single_user).map(v => [v.prompt_tok, v.ttft_p50_s]);
  const [lin, pair] = lstsq(pts.map(([C]) => [C, C * C / 2]), pts.map(p => p[1]));
  const m = model(k), F = (box === 'spark' ? 250 : 1000) * 1e12, g = E.CAL[MODELS[k]].group;
  cold[box + k] = { effLin: 2 * m.params_active_b * 1e9 / (F * lin), effAttn: 2 * g * m.kv_bytes_per_token_fp8 / (F * pair) };
  console.log('cold', box, k, 'lin us/tok', (lin * 1e6).toFixed(2), 'pair ns', (pair * 1e9).toFixed(3), 'effLin', cold[box + k].effLin.toFixed(3), 'effAttn', cold[box + k].effAttn.toFixed(3));
}
for (const k of ks) Object.assign(E.CAL[MODELS[k]], { effLin: +cold['pro6000' + k].effLin.toFixed(3), effAttn: +cold['pro6000' + k].effAttn.toFixed(3) });
const gbr = ks.map(k => [cold['spark' + k].effLin / cold['pro6000' + k].effLin, cold['spark' + k].effAttn / cold['pro6000' + k].effAttn]);
console.log('GB10 prefill efficiency ratio (lin/attn):', ks.map((k, i) => k + ' ' + gbr[i].map(x => x.toFixed(2)).join('/')).join('  '));
out.gb10PrefillEff = +mean(gbr.flat()).toFixed(2);
ks.forEach((k, i) => console.log('  LOO factor without', k, mean(gbr.filter((_, j) => j !== i).flat()).toFixed(2), '(its own', mean(gbr[i]).toFixed(2) + ')'));

// ---- 2. decode stage 1 (PRO r2): t = T0_m + (W(N)+extra)/BW + stateCost*N*2S/BW + N*(Cd*kv+kc)/(kvEff*BW) + theta2*(N-1)*tau/256
E.ASSUME.gb10PrefillEff = 1; E.ASSUME.unifiedMemGain = 1;
const feat = (box, k, r) => { const p = P(box, k), L = lay(k), N = r.N, C = r.C, Cd = C + 128, tau = I.turnS(p, miss(L, C) + 400, C);
  return { fixed: (p.wBytes(N) + p.extra) / p.BW, xs: N * 2 * L.state / p.BW, xkv: N * (Cd * L.kv + L.kc) / p.BW, xint: (N - 1) * tau / 256 }; };
function fitDecode(only) { // only = the models to fit on (default all); returns [T0 per model in `only`..., stateCost, 1/kvEff, interleave]
  const use = only || ks, A = [], y = [];
  for (const [i, k] of use.entries()) for (const r of fu('pro6000', 'r2', k)) { const f = feat('pro6000', k, r);
    A.push(use.map((_, j) => (j === i ? 1 : 0)).concat([f.xs, f.xkv, f.xint])); y.push(1 / r.d10 - f.fixed); }
  return lstsq(A, y);
}
for (const k of ks) Object.assign(E.CAL[MODELS[k]], { extraGB: 0 });
let c = fitDecode();
out.stateCost = +c[3].toFixed(3); out.kvEff = +(1 / c[4]).toFixed(3); out.interleave = +c[5].toFixed(3);
ks.forEach((k, i) => (E.CAL[MODELS[k]].stepMs = +(c[i] * 1e3).toFixed(2)));
Object.assign(E.ASSUME, { stateCost: out.stateCost, kvEff: out.kvEff, interleave: out.interleave });
console.log("stage1 T0' ms", ks.map((k, i) => (c[i] * 1e3).toFixed(2)).join(' '), '| stateCost', out.stateCost, '| kvEff', out.kvEff, '| interleave', out.interleave);
out.stage1 = JSON.parse(JSON.stringify(E.CAL)); out.stage1assume = { stateCost: out.stateCost, kvEff: out.kvEff, interleave: out.interleave };
const stepErr = (box, k) => { const p = P(box, k), L = lay(k);
  return fu(box, 'r2', k).map(r => I.stepS(p, L, r.N, r.C + 128, (r.N - 1) * I.turnS(p, miss(L, r.C) + 400, r.C) / 256) * r.d10 - 1); };
const show = tag => { for (const box of ['pro6000', 'spark']) for (const k of ks) { const e = stepErr(box, k);
  console.log(' ', tag, 'decode p10 step', box, k, 'mean signed', pct(mean(e)), 'mean abs', pct(mean(e.map(Math.abs))), 'max', pct(Math.max(...e.map(Math.abs)))); } };
show('stage1');

// ---- 3. stage 2: per-model extra bytes from ONE single-user Spark decode (chat, ~4k context), T0 re-split
for (const k of ks) { const cal = E.CAL[MODELS[k]], Tp = cal.stepMs / 1e3, pP = P('pro6000', k), pS = P('spark', k);
  const su = cfg('spark', k).single_user.chat, rest = I.stepS(pS, lay(k), 1, su.prompt_tok + 250, 0) - Tp;
  const X = Math.max(0, (1 / su.decode_tps_p50 - Tp - rest) / (1 / pS.BW - 1 / pP.BW));
  cal.extraGB = +(X / 1e9).toFixed(2); cal.stepMs = +((Tp - X / pP.BW) * 1e3).toFixed(2);
}
c = fitDecode(); // refit the shared terms with the extra bytes in place (T0 absorbs the rest on the PRO)
out.stateCost = +c[3].toFixed(3); out.kvEff = +(1 / c[4]).toFixed(3); out.interleave = +c[5].toFixed(3);
ks.forEach((k, i) => (E.CAL[MODELS[k]].stepMs = +(c[i] * 1e3).toFixed(2)));
Object.assign(E.ASSUME, { stateCost: out.stateCost, kvEff: out.kvEff, interleave: out.interleave });
console.log('stage2 extraGB', ks.map(k => E.CAL[MODELS[k]].extraGB).join(' '), '| T0 ms', ks.map(k => E.CAL[MODELS[k]].stepMs).join(' '), '| stateCost', out.stateCost, 'kvEff', out.kvEff, 'interleave', out.interleave);
out.loo = {}; // shared decode terms refitted without each model (for the "never measured" validation)
for (const k of ks) { const kk = ks.filter(x => x !== k), cc = fitDecode(kk);
  out.loo[k] = { stateCost: +cc[2].toFixed(3), kvEff: +(1 / cc[3]).toFixed(3), interleave: +cc[4].toFixed(3) };
  console.log('  LOO shared decode terms without', k, JSON.stringify(out.loo[k])); }

// ---- 4. GB10 memory gain on KV/state reads: grid search on Spark r2, leave one model out
const sparkErr = (gain, kk) => { E.ASSUME.unifiedMemGain = gain; return mean(kk.flatMap(k => stepErr('spark', k).map(Math.abs))); };
const grid = [...Array(41)].map((_, i) => 0.8 + i * 0.02), best = kk => grid.reduce((a, g) => (sparkErr(g, kk) < sparkErr(a, kk) ? g : a));
for (const k of ks) { const g = best(ks.filter(x => x !== k)); console.log('  LOO gain without', k, g.toFixed(2), '-> its error', pct(sparkErr(g, [k])), '(gain 1.0:', pct(sparkErr(1, [k])) + ')'); }
out.unifiedMemGain = +best(ks).toFixed(2); E.ASSUME.unifiedMemGain = out.unifiedMemGain; E.ASSUME.gb10PrefillEff = out.gb10PrefillEff;
console.log('unifiedMemGain', out.unifiedMemGain); show('stage2');

// ---- 5. first turn (PRO r1): TTFT p95 = base + phi*N*tau; decode r1 = r2 + theta*N*tau/256
{ const A = [], y = [], A2 = [], y2 = [];
  for (const k of ks) { const p = P('pro6000', k), L = lay(k);
    for (const r of fu('pro6000', 'r1', k)) { const tau = I.turnS(p, miss(L, r.C) + 400, r.C); A.push([r.N * tau]); y.push(r.ttft95 - 0.25);
      const r2 = fu('pro6000', 'r2', k).find(x => x.N === r.N && x.prof === r.prof); if (r2) { A2.push([r.N * tau / 256]); y2.push(1 / r.d10 - 1 / r2.d10); } } }
  out.ttftBaseS = 0.25; out.ttftPhi = +lstsq(A, y)[0].toFixed(3); out.r1Theta = +lstsq(A2, y2)[0].toFixed(3);
  console.log('TTFT burst (PRO, base fixed 0.25 s): phi', out.ttftPhi, 'mean err', pct(mean(A.map((a, i) => Math.abs(out.ttftPhi * a[0] / y[i] - 1)))), '| r1 theta', out.r1Theta);
  for (const k of ks) { const p = P('spark', k), L = lay(k);
    const ee = fu('spark', 'r1', k).map(r => (0.25 + out.ttftPhi * r.N * I.turnS(p, miss(L, r.C) + 400, r.C)) / r.ttft95 - 1);
    console.log('  Spark TTFT r1 (out of sample)', k, 'mean signed', pct(mean(ee)), 'mean abs', pct(mean(ee.map(Math.abs)))); }
}
console.log('\nCAL =', JSON.stringify(E.CAL));
console.log('ASSUME =', JSON.stringify(out, (k, v) => (k.startsWith('stage1') ? undefined : v)));
require('fs').writeFileSync(__dirname + '/calibration.json', JSON.stringify({ CAL: E.CAL, out }, null, 1));
