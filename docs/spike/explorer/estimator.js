/* LlmOnLan capacity estimator - "which model, how much context, on what hardware".
   Plain functions, no imports. Browser: window.Estimator. Node: module.exports.
   Estimator.init(catalog, measured) once, then Estimator.estimate(hwId, modelId, opts).
   Constants fitted by _est/calibrate.js on measured.json; checked by _est/validate.js (2026-10-07). */
(function (root) {
  'use strict';
  const GiB = 1073741824;

  // ---- Named assumptions. The page may show them and override any: opts.assume = { name: value }.
  // A triplet is [pessimistic, central, optimistic]; the three runs give people low / mid / high.
  const ASSUME = {
    passTtftS: 5, passDecodeTps: 15,      // the spike's pass rule: TTFT p95 < 5 s, decode p10 >= 15 tok/s
    newTokens: 400,                       // re-sent uncached each turn: question + last visible answer (spike follow-up)
    replyTokens: 256,                     // visible reply length (spike follow-up profile)
    kvFill: [0.88, 0.905, 0.93],          // usable share of vLLM's KV pool (0.93 = highest fill that passed)
    cacheMissShare: [0.9, 0.5, 0.1],      // hybrids: share of a cache block re-computed per turn (prefix hits at block edges)
    stepMs: [4.1, 3.27, 2.5],             // fixed cost of a decode step, any platform (generic; measured 2.8-4.1 ms)
    moeExtraGB: [1.1, 0.62, 0.15],        // MoE bytes read per step beyond active params x bits (lm_head...), generic
    bytesScale: [1.15, 1, 0.87],          // active params x bits: uncertainty for models never measured
    routeDraws: [1, 0.75, 0.5],           // MoE: distinct experts per step as if 1 + (N-1) x this tokens were routed uniformly
    calScale: [1.1, 1, 0.92],             // step / prefill time spread for measured models on other boxes
    stateCost: 1.145,                     // recurrent state read + written each step (2 x raw) at 1/1.145 = 87 % of BW (fitted)
    kvEff: 0.757,                         // batched KV reads reach this share of nominal bandwidth (fitted, one value for all)
    kvEffSpread: [0.88, 1, 1.16],         // generic models: KV read efficiency spread (leave-one-model-out fits: 0.67-0.88)
    interleave: [0.8, 0.746, 0.45],       // others' turn prefill lands in the decode stream: + this x (N-1) x turn / reply (fitted)
    unifiedMemGain: 1.0,                  // GB10 LPDDR5x read efficiency vs GDDR7 (fit 1.04; leave-one-model-out: no gain)
    effLinMoE: [0.18, 0.23, 0.28],        // prefill GEMM efficiency vs FP8 dense TFLOPS, MoE (measured 0.21-0.26)
    effLinDense: [0.45, 0.6, 0.72],       // same, dense (measured 0.73 for W4A4 NVFP4)
    effAttn: [0.21, 0.25, 0.31],          // prefill attention efficiency vs FP8 dense TFLOPS (measured 0.23-0.31)
    gb10PrefillEff: 0.83,                 // GB10 prefill efficiency relative to the RTX cards (fitted)
    gqaGroup: 8, mlaGroup: 64,            // attention FLOPs per (query, context) pair = 2 x group x KV bytes (fp8)
    ttftBaseS: 0.25, ttftPhi: 1.071,      // first-turn burst: TTFT p95 = base + phi x N x one person's turn prefill
    r1Theta: 0.335,                       // first-turn decode slowed by theta x (burst prefill / reply length)
    runtimeGiB: 3.7,                      // vLLM CUDA graphs + activations (PRO 6000, measured)
    linkGbps: 185,                        // two Sparks: RoCE measured aggregate (ConnectX-7, not NVLink)
    allReduceUs: [70, 55, 40],            // TP=2: per all-reduce latency (2 per layer), fitted to 2 reported 1-vs-2-Spark pairs
  };

  // Per measured model: fitted on the PRO 6000 (follow-up curves, cold prefill) + one single-user Spark decode.
  const CAL = {
    'qwen3.6-35b-a3b': { key: 'qwen36', stepMs: 4.1, extraGB: 0.29, effLin: 0.257, effAttn: 0.227, group: 8 },
    'nemotron-3.5-lightning-30b-a3b': { key: 'nemotron', stepMs: 2.9, extraGB: 0.95, effLin: 0.21, effAttn: 0.314, group: 16 },
    'qwen3.8-27b': { key: 'qwen38', stepMs: 2.81, extraGB: 0, effLin: 0.734, effAttn: 0.234, group: 6 },
  };
  const BOX = { 'rtx-pro-6000-ws': 'pro6000', 'dgx-spark': 'spark' };
  const CTX = { '32k': 30200, '64k': 62000, '128k': 120100 }; // the spike's follow-up context sizes

  let DATA = { catalog: null, measured: null };
  const init = (catalog, measured) => { DATA = { catalog, measured: measured || null }; };
  const byId = (list, id) => (typeof id === 'string' ? list.find(x => x.id === id) : id);
  const avg = a => (Array.isArray(a) ? (a[0] + a[a.length - 1]) / 2 : a);
  const at = (v, run) => (Array.isArray(v) && typeof v[0] === 'number' ? v[run] : v);

  // ---- Hardware
  function resolveHw(hw) {
    hw = byId(DATA.catalog.hardware, hw);
    if (hw.kind !== 'cluster') return { hw, node: hw, nodes: 1 };
    return { hw, node: byId(DATA.catalog.hardware, hw.members[0]), nodes: hw.members.length };
  }
  const isGb10 = node => /GB10/.test(node.arch || '');
  const tflops = node => node.fp8_tflops_dense || (node.fp4_tflops_sparse || avg(node.fp4_tflops_sparse_est)) / 4;
  function budgetGiB(hw, which) {
    const b = hw.budget || {};
    if (which === 'single_user') return b.single_user_max_gib;
    if (which === 'farm_no_ocr') return b.farm_no_ocr_gib || b.farm_gib || b.single_user_max_gib;
    return b.farm_with_ocr_gib || b.farm_gib || b.farm_no_ocr_gib || b.single_user_max_gib;
  }

  // ---- Model structure
  function linearLayers(m) {
    if (m.arch.linear && m.arch.linear.layers) return m.arch.linear.layers;
    const r = /(\d+) (?:Gated DeltaNet|Mamba|Kimi Delta|KDA)/i.exec(m.arch.attention || '');
    return r ? +r[1] : 0;
  }
  function moeSplit(m) { // experts touched per step grow with the batch: D always read, X experts by coverage
    const t = m.arch.type || '';
    if (!/MoE/i.test(t)) return null;
    const E = +((/(\d+) experts/.exec(t) || [])[1]) || 128, k = +((/(\d+) (?:routed|active)/.exec(t) || [])[1]) || 8;
    const p = k / E, X = (m.params_total_b - m.params_active_b) / (1 - p);
    return { p, X, D: Math.max(0, m.params_total_b - X) };
  }
  function kvLayout(m, dtype) { // vLLM 0.30 paging; reproduces the spike's start-up lines for the three measured models
    const f = dtype === 'bf16' ? 2 : 1, kv = (m.kv_bytes_per_token_fp8 || 4096) * f;
    const L = m.arch.layers, lin = linearLayers(m), att = m.arch.full_attn_layers || (L - lin) || L;
    const state = m.recurrent_state_bytes || 0, kc = (m.kv_constant_bytes_per_request || 0) * f;
    if (state > 0 && lin > 0) {
      const block = Math.ceil(state / lin / (kv / att) / 16) * 16;     // page sized to hold one layer's state
      return { kv, att, lin, state, kc, block, page: block * kv, fixed: 2 * Math.ceil(lin / att), guessed: !m.kv_bytes_per_token_fp8 };
    }
    return { kv, att, lin, state, kc, block: 16, page: 16 * kv, fixed: 0, guessed: !m.kv_bytes_per_token_fp8 };
  }
  const personBytes = (lay, tokens) => (Math.ceil(tokens / lay.block) + lay.fixed) * lay.page + lay.kc;
  const bytesClass = bpp => (bpp >= 1.5 ? 16 : bpp >= 0.9 ? 8 : bpp >= 0.52 ? 4 : 3);
  function pickCheckpoint(m, budget, onePersonGiB, want) {
    const cks = m.checkpoints.map(c => ({ format: c.format, repo: c.repo, bpp: c.bytes_per_param_avg, gguf: /GGUF/i.test(c.format),
      weightsGiB: c.loaded_gib_measured || c.resident_gib_est || c.disk_gib, bits: bytesClass(c.bytes_per_param_avg), measured: !!c.loaded_gib_measured }));
    const wanted = want && cks.find(c => c.format === want);
    if (wanted) return wanted;
    const rank = c => (c.measured ? 0 : 1) + (c.gguf ? 20 : 0) + { 4: 0, 8: 2, 16: 4, 3: 10 }[c.bits] + c.weightsGiB / 1e4;
    cks.sort((a, b) => rank(a) - rank(b));
    return cks.find(c => c.weightsGiB + onePersonGiB <= budget) || cks.slice().sort((a, b) => a.weightsGiB - b.weightsGiB)[0];
  }

  // ---- Physics for one run (0 pessimistic, 1 central, 2 optimistic)
  function physics(H, m, ck, lay, run, cluster) {
    const cal = CAL[m.id], node = H.node, gb10 = isGb10(node), tp = cluster === 'tp' ? H.nodes : 1;
    const moe = moeSplit(m), bs = cal ? 1 : at(ASSUME.bytesScale, run), cs = cal ? at(ASSUME.calScale, run) : 1;
    const bpp = ck.bpp * bs * 1e9, mem = gb10 ? ASSUME.unifiedMemGain : 1;
    const kvEff = ASSUME.kvEff * (cal ? 1 : at(ASSUME.kvEffSpread, run)) * mem;
    const effLin = (cal ? cal.effLin : at(moe ? ASSUME.effLinMoE : ASSUME.effLinDense, run)) * (gb10 ? ASSUME.gb10PrefillEff : 1);
    const effAttn = (cal ? cal.effAttn : at(ASSUME.effAttn, run)) * (gb10 ? ASSUME.gb10PrefillEff : 1);
    const group = cal ? cal.group : m.arch.mla ? ASSUME.mlaGroup : ASSUME.gqaGroup;
    const F = tflops(node) * 1e12 * tp, BW = node.bandwidth_gbs * 1e9 * tp;
    const hidden = Math.min(8192, Math.max(2048, Math.sqrt(m.params_active_b * 1e9 / (12 * m.arch.layers))));
    const linkBps = ASSUME.linkGbps / 8 * 1e9, arS = at(ASSUME.allReduceUs, run) / 1e6;
    const draws = at(ASSUME.routeDraws, cal ? 1 : run);
    const wBytes = N => (moe ? moe.D + moe.X * (1 - Math.pow(1 - moe.p, 1 + (N - 1) * draws)) : m.params_active_b) * bpp;
    return {
      cs, tp, layers: m.arch.layers, hidden, linkBps,
      T0: (cal ? cal.stepMs : at(ASSUME.stepMs, run)) / 1e3,
      extra: (cal ? cal.extraGB : moe ? at(ASSUME.moeExtraGB, run) : 0) * 1e9,
      wBytes, BW, F, A: m.params_active_b * 1e9,
      stateRW: 2 * lay.state * ASSUME.stateCost / mem, kvEff, effLin, effAttn, inter: at(ASSUME.interleave, cal ? 1 : run),
      fa: 2 * group * (m.kv_bytes_per_token_fp8 || 4096),
      comm: N => (tp > 1 ? 2 * m.arch.layers * (arS + N * hidden * 2 / linkBps) : 0),
    };
  }
  // decode step time (s, p10 of the batch) for N people with Cd tokens of context each; burst = (N-1) x turn / reply
  function stepS(P, lay, N, Cd, burst) {
    const bytes = P.wBytes(N) + P.extra + N * P.stateRW + N * (Cd * lay.kv + lay.kc) / P.kvEff;
    return P.cs * (P.T0 + Math.max(bytes / P.BW, N * 2 * P.A / (P.F * P.effLin)) + P.comm(N)) + P.inter * (burst || 0); // roofline
  }
  const linS = P => P.cs * (2 * P.A / (P.F * P.effLin) + (P.tp > 1 ? 4 * P.layers * P.hidden / P.linkBps : 0)); // per prompt token
  const pairS = P => P.cs * P.fa / (P.F * P.effAttn);                     // per (new token, context token) pair
  const coldS = (P, C) => P.T0 + C * linS(P) + C * C / 2 * pairS(P);      // one person, nothing cached
  const turnS = (P, q, C) => q * (linS(P) + C * pairS(P));                // one person's new turn, context cached

  // Hybrid models (vLLM align mode) hit the prefix cache only at block edges: part of a block is re-computed each
  // turn. A class averages half a block; the spike's users all shared one remainder (opts.cacheMissTokens sets it).
  const missTokens = (lay, o, run) => (o.cacheMissTokens != null ? o.cacheMissTokens : lay.block > 16 ? at(ASSUME.cacheMissShare, run) * lay.block : 0);

  // ---- People at once for one run
  function solve(P, lay, o, run, poolBytes) {
    const out = o.replyTokens * o.thinking, Cd = o.context + out / 2, Ctot = o.context + out;
    const tau = turnS(P, o.newTokens + missTokens(lay, o, run), o.context), tMax = 1 / ASSUME.passDecodeTps;
    const kvN = Math.floor(at(ASSUME.kvFill, run) * poolBytes / personBytes(lay, Ctot));
    const step = N => stepS(P, lay, N, Cd, (N - 1) * tau / out);
    const ok = { decode: N => step(N) <= tMax, r1: N => step(N) + ASSUME.r1Theta * N * tau / out <= tMax,
      ttft: N => ASSUME.ttftBaseS + ASSUME.ttftPhi * N * tau < ASSUME.passTtftS };
    const maxN = f => { let lo = 0, hi = 1; while (hi < 65536 && f(hi)) { lo = hi; hi *= 2; }
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f(mid)) lo = mid; else hi = mid; } return lo; };
    const lim = { 'memory (KV)': kvN, 'decode bandwidth': maxN(ok.decode), 'decode bandwidth (first turn)': maxN(ok.r1), 'prefill compute (first token)': maxN(ok.ttft) };
    const steady = Math.min(lim['memory (KV)'], lim['decode bandwidth']);
    const every = Math.min(steady, lim['decode bandwidth (first turn)'], lim['prefill compute (first token)']);
    const bindOf = keys => keys.reduce((a, k) => (lim[k] < lim[a] ? k : a));
    return { every, steady, lim, bindEvery: bindOf(Object.keys(lim)), bindSteady: bindOf(['memory (KV)', 'decode bandwidth']),
      singleTps: 1 / stepS(P, lay, 1, Cd, 0), coldS: coldS(P, o.context), turnS: ASSUME.ttftBaseS + tau, kvN };
  }

  // ---- Measured lookup (vLLM follow-up profiles, fp8 KV)
  function measuredCell(hwId, m, o) {
    const mj = DATA.measured, cal = CAL[m.id];
    if (!mj || !cal || !BOX[hwId] || o.kvDtype !== 'fp8') return null;
    const ctx = Object.keys(CTX).find(k => Math.abs(o.context - CTX[k]) / CTX[k] <= 0.1);
    const cfg = ctx && mj.configs.find(c => c.id === BOX[hwId] + '/vllm/' + cal.key);
    const p = cfg && cfg.people['followup_' + ctx];
    if (!p) return null;
    const range = r => (!r ? null : { low: r.pass || 0, high: r.fail ? r.fail - 1 : null, label: r.label, tested: r.tested });
    let every = range(p.every), steady = range(p.steady);
    if (ASSUME.passTtftS !== 5 || ASSUME.passDecodeTps !== 15) { // another bar: re-apply it to the measured tails
      const lv = cfg.profiles[p.profile].levels, cs = [...new Set(lv.map(l => l.c))].sort((a, b) => a - b);
      const ok = r => r && r.ttft_p95 < ASSUME.passTtftS && r.dec_p10 >= ASSUME.passDecodeTps;
      const relabel = f => { const pass = Math.max(0, ...lv.filter(f).map(l => l.c)), fail = cs.find(c => c > pass && !lv.some(l => l.c === c && f(l)));
        return { low: pass, high: fail ? fail - 1 : null, label: pass ? (fail ? '' : '≥ ') + pass : '< ' + cs[0], tested: cs }; };
      every = relabel(l => !l.err && ok(l.r1) && ok(l.r2)); steady = relabel(l => !l.err && ok(l.r2));
    }
    const cold = cfg.cold_prefill_single_user[ctx];
    return { config: cfg.id, ctx, profile: p.profile, every, steady,
      coldS: cold && cold.ttft_p50_s, singleTps: cold && cold.decode_tps_after, quality: cfg.quality };
  }

  // ---- Public: one box x one model x one setting
  function withAssume(opts, fn) {
    const saved = Object.assign({}, ASSUME);
    try { Object.assign(ASSUME, (opts && opts.assume) || {}); return fn(); } finally { Object.assign(ASSUME, saved); }
  }
  const estimate = (hwId, modelId, opts) => withAssume(opts, () => estimate1(hwId, modelId, opts));
  // opts: context (tokens per person), mode 'every'|'steady', thinking (reply-length multiplier), kvDtype 'fp8'|'bf16',
  // budget 'farm'|'farm_no_ocr'|'single_user', poolGiB (KV pool override), cluster 'auto'|'tp'|'replicas',
  // replyTokens, newTokens, cacheMissTokens, checkpoint (format), assume {name: value}
  function estimate1(hwId, modelId, opts) {
    const o = Object.assign({ context: 32768, mode: 'every', thinking: 1, kvDtype: 'fp8', budget: 'farm', cluster: 'auto' }, opts);
    o.replyTokens = o.replyTokens || ASSUME.replyTokens; o.newTokens = o.newTokens || ASSUME.newTokens;
    const H = resolveHw(hwId), m = byId(DATA.catalog.models, modelId), lay = kvLayout(m, o.kvDtype);
    const nodeBudget = budgetGiB(H.node, o.budget) || 0, totalBudget = budgetGiB(H.hw, o.budget) || 0;
    const onePerson = personBytes(lay, o.context + o.replyTokens * o.thinking) / GiB;
    let ck = pickCheckpoint(m, nodeBudget, onePerson, o.checkpoint), cluster = 'single';
    if (H.nodes > 1) { // one copy per node when the best checkpoint fits a node, else one copy split across nodes (TP)
      const ckTp = pickCheckpoint(m, totalBudget, onePerson, o.checkpoint);
      cluster = o.cluster !== 'auto' ? o.cluster : ck.format === ckTp.format && ck.weightsGiB + onePerson <= nodeBudget ? 'replicas' : 'tp';
      if (cluster === 'tp') ck = ckTp;
    }
    const copies = cluster === 'replicas' ? H.nodes : 1, unit = cluster === 'tp' ? H.hw : H.node; // memory is per copy
    const budget = o.poolGiB != null ? ck.weightsGiB + o.poolGiB : cluster === 'tp' ? totalBudget : nodeBudget;
    const poolGiB = budget - ck.weightsGiB, poolBytes = poolGiB * GiB, runtime = ASSUME.runtimeGiB * (cluster === 'tp' ? H.nodes : 1);
    const res = { hw: H.hw.id, model: m.id, cluster, copies, checkpoint: ck, engine: ck.gguf ? 'llama.cpp (GGUF)' : 'vLLM / SGLang',
      opts: { context: o.context, mode: o.mode, thinking: o.thinking, kvDtype: o.kvDtype, budget: o.budget, replyTokens: o.replyTokens, newTokens: o.newTokens },
      memory: { perCopy: true, visibleGiB: unit.memory_gib_visible, budgetGiB: budget, weightsGiB: ck.weightsGiB, runtimeGiB: runtime,
        reservedGiB: unit.memory_gib_visible - budget - runtime, kvPoolGiB: Math.max(0, poolGiB),
        perPersonMiB: { kv: (personBytes(lay, o.context + o.replyTokens * o.thinking) - lay.fixed * lay.page) / 1048576,
          state: lay.fixed * lay.page / 1048576, total: onePerson * 1024 }, block: lay.block, kvGuessed: lay.guessed },
      notes: [] };
    if (ck.bits === 3) res.notes.push('Fits only at <= 3-bit (GGUF): quality loss likely.');
    if (ck.gguf) res.notes.push('GGUF runs on llama.cpp: the spike measured it serving far fewer people than vLLM; people below assume vLLM-class batching.');
    if (lay.guessed) res.notes.push('KV size unknown: 4 KB/token assumed.');
    const runs = [0, 1, 2].map(r => solve(physics(H, m, ck, lay, r, cluster), lay, o, r, poolBytes));
    const tri = f => ({ low: f(runs[0]), mid: f(runs[1]), high: f(runs[2]) });
    if (poolGiB <= onePerson) {
      res.fits = false; res.binding = 'does not fit';
      res.people = res.peopleEvery = res.peopleSteady = { low: 0, mid: 0, high: 0 };
      res.notes.push(ck.weightsGiB > budget ? 'Weights alone exceed the memory budget.' : 'No room left for one person\'s context.');
    } else {
      res.fits = true;
      res.peopleEvery = tri(r => r.every * copies); res.peopleSteady = tri(r => r.steady * copies);
      res.people = o.mode === 'steady' ? res.peopleSteady : res.peopleEvery;
      res.binding = o.mode === 'steady' ? runs[1].bindSteady : runs[1].bindEvery;
      res.limits = runs[1].lim;
    }
    const alone = f => { if (ck.weightsGiB >= budget) return null; // speeds are meaningless when the weights do not fit
      const v = [0, 1, 2].map(i => f(runs[i])), lo = Math.min(...v), hi = Math.max(...v); return { low: lo, mid: v[1], high: hi }; };
    res.singleUserTps = alone(r => r.singleTps);        // one person alone, at this context
    res.coldPromptS = alone(r => r.coldS);              // one person pastes the whole context, nothing cached
    res.turnS = alone(r => r.turnS);                    // one person's follow-up TTFT, context cached
    res.answerS = alone(r => r.turnS + o.replyTokens * o.thinking / r.singleTps);
    res.maxContextOnePerson = maxContext(lay, poolBytes, m);
    const cell = cluster === 'single' && measuredCell(H.hw.id, m, o);
    res.confidence = cell ? 'measured' : CAL[m.id] ? 'calibrated' : 'estimated';
    if (cell) { // measured people = the highest tested level that passed (mid/low) up to the next tested level (high)
      const kvCap = [0, 1, 2].map(r => runs[r].kvN), cap = (r, est) => (!r ? est : {
        low: Math.min(r.low, kvCap[0]), mid: Math.min(r.low, kvCap[1]), high: Math.min(r.high == null ? Math.max(r.low, est.high) : r.high, kvCap[2]) });
      res.measured = cell; res.modelPeople = { every: res.peopleEvery, steady: res.peopleSteady };
      res.peopleEvery = cap(cell.every, res.peopleEvery); res.peopleSteady = cap(cell.steady, res.peopleSteady);
      res.people = o.mode === 'steady' ? res.peopleSteady : res.peopleEvery;
      if ((cell.every && kvCap[1] < cell.every.low) || (cell.steady && kvCap[1] < cell.steady.low)) res.notes.push('Measured with a 58 GiB KV pool; this budget\'s smaller pool caps it by KV.');
      if (cell.singleTps) res.singleUserTps = { low: cell.singleTps, mid: cell.singleTps, high: cell.singleTps };
      if (cell.coldS) res.coldPromptS = { low: cell.coldS, mid: cell.coldS, high: cell.coldS };
      if (lay.block > 16 && cell.every) res.notes.push('In the spike every user had the same context length, so all re-computed the same part of a ' + lay.block +
        '-token cache block each turn. A class with mixed lengths re-computes half a block on average: every turn then ~' + res.modelPeople.every.mid +
        ' (' + res.modelPeople.every.low + '-' + res.modelPeople.every.high + ').');
    }
    return res;
  }
  function maxContext(lay, poolBytes, m) {
    const usable = ASSUME.kvFill[1] * poolBytes - lay.fixed * lay.page - lay.kc;
    const kvTok = usable > 0 ? Math.floor(usable / lay.kv / lay.block) * lay.block : 0;
    return { tokens: Math.min(kvTok, m.context_native || kvTok), extended: Math.min(kvTok, m.context_max || kvTok), byKv: kvTok,
      native: m.context_native, max: m.context_max }; // tokens: within the trained window; extended: with the vendor's YaRN-style scaling
  }

  // ---- Public: speed per person as more people join (for charts)
  const curve = (hwId, modelId, opts, Ns) => withAssume(opts, () => curve1(hwId, modelId, opts, Ns));
  function curve1(hwId, modelId, opts, Ns) {
    const r = estimate1(hwId, modelId, opts), H = resolveHw(hwId), m = byId(DATA.catalog.models, modelId);
    const lay = kvLayout(m, r.opts.kvDtype), P = physics(H, m, r.checkpoint, lay, 1, r.cluster);
    const out = r.opts.replyTokens * r.opts.thinking, Cd = r.opts.context + out / 2;
    const tau = turnS(P, r.opts.newTokens + missTokens(lay, opts || {}, 1), r.opts.context);
    return (Ns || [1, 2, 4, 8, 16, 24, 32, 48, 64, 96, 128]).map(N => ({ N: N * r.copies,
      decodeTps: 1 / stepS(P, lay, N, Cd, (N - 1) * tau / out), firstTurnTtftS: ASSUME.ttftBaseS + ASSUME.ttftPhi * N * tau }));
  }

  // ---- Public: does each model fit each box at all, and the longest context one person could have
  function fitTable(opts) { // per model x box: farm budget and single-user budget (clusters split one copy, TP)
    const o = Object.assign({ kvDtype: 'fp8', farmBudget: 'farm' }, opts), rows = [];
    const cell = r => ({ fits: r.fits, checkpoint: r.checkpoint.format, bits: r.checkpoint.bits, gguf: r.checkpoint.gguf,
      weightsGiB: r.checkpoint.weightsGiB, maxContext: r.fits ? r.maxContextOnePerson.tokens : 0, maxContextExtended: r.fits ? r.maxContextOnePerson.extended : 0 });
    for (const m of DATA.catalog.models) for (const h of DATA.catalog.hardware) rows.push({ model: m.id, hw: h.id,
      farm: cell(estimate(h.id, m.id, { context: 4096, kvDtype: o.kvDtype, budget: o.farmBudget, cluster: 'tp' })),
      alone: cell(estimate(h.id, m.id, { context: 4096, kvDtype: o.kvDtype, budget: 'single_user', cluster: 'tp' })) });
    return rows;
  }

  const meta = { version: '2026-10-07', data: 'measured.json 2026-10-07 (spike 2026-10-04..06), catalog.json 2026-10-07', engine: 'vLLM 0.30-class batching' };
  const api = { init, estimate, curve, fitTable, ASSUME, CAL, meta,
    _internal: { resolveHw, kvLayout, personBytes, physics, stepS, coldS, turnS, linS, pairS, solve, moeSplit, pickCheckpoint, budgetGiB } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Estimator = api;
  else root.Estimator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
