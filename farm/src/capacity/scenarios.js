/* LlmOnLan capacity scenarios: "I want to do X with N people" -> the hardware x model pairs that cover it.
   Plain functions, no imports. Browser: window.Scenarios. Node: module.exports.
   Every figure comes from the estimator (estimator.js); this file only chooses its inputs, filters and ranks.
   Checked by farm/test/run.js ("capacity scenarios"). */
(function (root) {
  'use strict';

  // How each LlmOnLan surface loads a farm, as estimator inputs and model needs (multiuser_implementation_plan.md
  // §1 use cases and §8 profiles; docs/spike/README.md profiles). mode: 'every' = everyone presses Enter together
  // (the first word within 5 s counts), 'steady' = people out of step. thinking multiplies the reply length.
  // budget: 'farm' keeps room for the farm's OCR model on the same card; 'single_user' gives the model all of it.
  const USES = {
    chat: { label: 'Chat in Open WebUI or LOL Vibe',
      what: 'Open WebUI or LOL Vibe, with a picture now and then: 32k of conversation each, short replies.',
      est: { context: 32768, mode: 'every', thinking: 1, replyTokens: 256, budget: 'farm' },
      need: { minContext: 32768, vision: true }, rank: 'price' },
    documents: { label: 'Ask questions about documents (RAG)',
      what: 'Open WebUI puts each whole document in the prompt only when a person has 24k or more, so 32k each. ' +
        'Scanned pages go through the farm\'s OCR model, which shares the card.',
      est: { context: 32768, mode: 'steady', thinking: 1, replyTokens: 512, budget: 'farm' },
      need: { minContext: 32768 }, rank: 'price' },
    coding: { label: 'The coding agent (LOL Vibe\'s IDE)',
      what: 'The coding agent works in back-to-back tool steps, each reply up to 8–16k tokens, over a 64k window. ' +
        'It needs tool calling and a model that scores well at agentic coding.',
      est: { context: 65536, mode: 'steady', thinking: 1, replyTokens: 4096, budget: 'farm' },
      need: { minContext: 65536, tools: true, coding: true }, rank: 'price' },
    computer: { label: 'The Computer (graphs, agents)',
      what: 'The Computer\'s boxes send short structured asks, one at a time per person, and think before deciding ' +
        '(replies ×4). Nobody waits on a first word.',
      est: { context: 32768, mode: 'steady', thinking: 4, replyTokens: 256, budget: 'farm' },
      need: { minContext: 32768 }, rank: 'price', prefer: 'people' },
    long: { label: 'Long documents (128k each)',
      what: 'A whole thesis or report in the prompt: 128k each, long feedback after some thinking. ' +
        'The wait to watch is the first word on a new document.',
      est: { context: 131072, mode: 'steady', thinking: 4, replyTokens: 512, budget: 'farm' },
      need: { minContext: 131072, good: true }, rank: 'price' },
    frontier: { label: 'The strongest model that fits',
      what: 'The best open model that fits, for one or two people: all the memory goes to the model (OCR on another ' +
        'box), 32k each, thinking on. Ranked by quality, then price.',
      est: { context: 32768, mode: 'steady', thinking: 4, replyTokens: 256, budget: 'single_user' },
      need: { minContext: 32768 }, rank: 'quality' },
  };

  // The ready-made cards. people = the head count to cover; mode overrides the use's own.
  const SCENARIOS = [
    { id: 'rag', use: 'documents', people: 5, title: 'Ask questions about documents (RAG)' },
    { id: 'xr', use: 'coding', people: 10, title: 'Vibe-code a three.js / WebXR app' },
    { id: 'class', use: 'chat', people: 30, title: 'A class chatting' },
    { id: 'workshop', use: 'computer', people: 20, title: 'A Computer workshop (graphs, agents)' },
    { id: 'reports', use: 'long', people: 2, title: 'Long reports and thesis feedback' },
    { id: 'frontier', use: 'frontier', people: 2, title: 'A near-frontier model for 1–2 teachers' },
  ];

  // One scenario, ready for recommend(): a card from SCENARIOS, or "your own" (use + people + mode).
  function scenario(useId, people, mode, extra) {
    const u = USES[useId] || USES.chat;
    const est = Object.assign({}, u.est, mode ? { mode } : {});
    return Object.assign({ use: useId, people: Math.max(1, Math.round(people) || 1), what: u.what, est, need: u.need,
      rank: u.rank, prefer: u.prefer || 'quality' }, extra || {});
  }
  const card = (s) => scenario(s.use, s.people, s.mode, { id: s.id, title: s.title });

  // ---- Model quality
  // score = BenchLM's open-model index (a third-party aggregate, the one scale the catalog has for nearly every model).
  // good = 40 or more: good enough for a farm, so a measured model wins over a slightly higher estimated one.
  const score = (m) => (m.aggregate_index && m.aggregate_index.benchlm_open != null ? m.aggregate_index.benchlm_open : null);
  const good = (m) => (score(m) >= 40 ? 1 : 0);
  // Agentic coding: one of these scores, vendor or third party, at or over its bar (Nemotron 3.5 Lightning's SWE-bench
  // Verified 52.8 is under it, as the spike found: "the model for the Computer, not the coding default").
  const CODING = [[/^SWE-bench(?! Pro)/i, 60], [/^SWE-bench Pro/i, 45], [/Terminal[- ]Bench/i, 45], [/DeepSWE|FrontierSWE/i, 50]];
  function codingEvidence(m) {
    for (const [re, bar] of CODING) {
      const q = (m.quality || []).find((x) => re.test(x.benchmark) && x.score >= bar);
      if (q) return q;
    }
    return null;
  }
  // The spike's own 28-item check (10 code, 7 exact answers, 11 tool round-trips), best of thinking on/off, any box.
  function spikeGate(m) {
    const sq = m.spike_quality; if (!sq) return null;
    const all = [sq.pro6000_think_on_off, sq.spark_think_on_off].join(' ').match(/\d+(?=\/28)/g) || [];
    return all.length ? Math.max(...all.map(Number)) : null;
  }
  // null when the model meets the needs, else the first reason it does not, in plain words.
  function unmet(m, need) {
    if ((m.context_native || 0) < (need.minContext || 0)) return 'reads at most ' + fmtK(m.context_native || 0);
    if (need.tools && !m.tools) return 'no tool calling';
    if (need.vision && !m.vision) return 'cannot read images';
    if (need.coding && !codingEvidence(m)) return 'no strong agentic-coding score';
    if (need.good && !good(m)) return 'a weaker model than this needs';
    return null;
  }

  // ---- Ranking
  const CONF = { measured: 0, calibrated: 1, estimated: 2 };
  const priceOf = (h) => h.price_eur_ttc || Infinity;
  const q = (p) => (score(p.model) == null ? -1 : score(p.model));
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // The best model on one box: good enough, then measured before estimated, then quality, then people. A 'quality'
  // scenario puts quality first; one that prefers 'people' (the Computer: short asks, speed over polish) people first.
  const byModel = (sc) => (a, b) => (sc.rank === 'quality' ? q(b) - q(a) : 0) || (sc.prefer === 'people' ? b.r.people.mid - a.r.people.mid : 0)
    || good(b.model) - good(a.model) || CONF[a.r.confidence] - CONF[b.r.confidence] || q(b) - q(a) || b.r.people.mid - a.r.people.mid
    || cmp(a.model.id, b.model.id);
  // Boxes: the cheapest that covers the head count ('price'), or the best model that does ('quality').
  const byBox = (sc) => (a, b) => (sc.rank === 'quality' ? q(b) - q(a) || priceOf(a.hw) - priceOf(b.hw)
    : priceOf(a.hw) - priceOf(b.hw)) || byModel(sc)(a, b) || cmp(a.hw.id, b.hw.id);
  const mostPeople = (sc) => (a, b) => b.r.people.mid - a.r.people.mid || byModel(sc)(a, b);

  const covers = (r, n) => r.people.low >= n && r.people.mid >= Math.ceil(n * 1.2);

  // The popular boxes a "why not" hint names when they fall short.
  const POPULAR = { 'dgx-spark': 'a DGX Spark', 'dgx-spark-x2': 'two linked DGX Sparks', 'rtx-pro-6000-ws': 'an RTX PRO 6000' };

  // E: the estimator, already init()ed with this catalog. opts: { hwId: this farm's box, servedId: the catalog model it
  // serves now, assume: {...} }.
  // Returns { picks: up to 3 pairs that cover the head count (one per box), thisFarm, whyNot: [...] }.
  // A pair = { hw, model, r (the estimate), covers, reason }. "Covers" = with room to spare: the middle estimate is
  // 20 % over the head count and even the pessimistic one reaches it (measured cells: the highest level that passed).
  // GGUF-only pairs run on llama.cpp, which served 2–24× fewer people than vLLM in the spike, and the GeForce cards are
  // the catalog's single-person references (never measured with a group), so both count only for one or two people.
  const solo = (hw) => /single-person/i.test(hw.name);
  function recommend(E, catalog, sc, opts) {
    opts = opts || {};
    const o = Object.assign({}, sc.est, opts.assume ? { assume: opts.assume } : {});
    const models = catalog.models.filter((m) => !unmet(m, sc.need));
    const perBox = {};
    for (const hw of catalog.hardware) for (const model of models) {
      let r; try { r = E.estimate(hw.id, model.id, o); } catch (e) { continue; }
      if (!r.fits) continue;
      const llama = r.checkpoint.gguf && sc.people > 2, one = !llama && solo(hw) && sc.people > 2;
      (perBox[hw.id] = perBox[hw.id] || []).push({ hw, model, r, llama, one, covers: !llama && !one && covers(r, sc.people) });
    }
    const best = (list, order) => list.slice().sort(order)[0] || null;
    // The best pair on one box: one that covers the head count, else the one serving the most. any = allow the
    // llama.cpp-only and single-person pairs (this farm's own box, when nothing else fits it).
    const boxBest = (id, any) => { const l = (perBox[id] || []).filter((p) => any || !(p.llama || p.one));
      return best(l.filter((p) => p.covers), byModel(sc)) || best(l, mostPeople(sc)); };
    const picks = Object.keys(perBox).map((id) => boxBest(id)).filter((p) => p && p.covers).sort(byBox(sc)).slice(0, 3);
    for (const p of picks) p.reason = reason(sc, p);
    let thisFarm = null;
    if (opts.hwId) {
      // What the farm serves now comes first when it covers the head count: an operator should not read a switch
      // into a card their current model already answers.
      const served = opts.servedId && (perBox[opts.hwId] || []).find((p) => p.model.id === opts.servedId && p.covers);
      const p = served || boxBest(opts.hwId) || boxBest(opts.hwId, true);
      thisFarm = p ? Object.assign(p, { served: !!served, reason: reason(sc, p) }) : { hw: catalog.hardware.find((h) => h.id === opts.hwId), none: true };
    }
    const whyNot = Object.keys(POPULAR).filter((id) => !picks.some((p) => p.hw.id === id) && id !== opts.hwId)
      .map((id) => ({ id, p: boxBest(id) })).filter((x) => !x.p || !x.p.covers).slice(0, 2)
      .map(({ id, p }) => ({ hw: catalog.hardware.find((h) => h.id === id), pair: p, text: whyNotText(sc, id, p) }));
    return { scenario: sc, picks, thisFarm, whyNot, models: models.length };
  }

  // ---- Plain words
  const fmtK = (t) => (t >= 1048576 ? (t / 1048576).toFixed(t % 1048576 ? 1 : 0) + 'M' : Math.round(t / 1024) + 'k');
  const SHORT = {
    'rtx-pro-6000-ws': 'RTX PRO 6000', 'rtx-pro-6000-maxq': 'RTX PRO 6000 Max-Q', 'rtx-pro-5500': 'RTX PRO 5500',
    'rtx-pro-5000-72': 'RTX PRO 5000 72 GB', 'rtx-pro-5000-48': 'RTX PRO 5000 48 GB', 'dgx-spark': 'DGX Spark',
    'dgx-spark-x2': 'two DGX Sparks', 'rtx-5090': 'RTX 5090', 'rtx-4080': 'RTX 4080', 'rtx-4070': 'RTX 4070',
  };
  const hwName = (h) => SHORT[h.id] || h.name;
  const modelName = (m) => m.name.replace(/\s*\(.*\)\s*$/, '');
  const BIND = {
    'memory (KV)': 'memory for everyone\'s conversations',
    'decode bandwidth': 'replies slowing below reading speed',
    'decode bandwidth (first turn)': 'replies slowing below reading speed when everyone starts together',
    'prefill compute (first token)': 'the first word coming too late when everyone starts together',
  };
  const peopleText = (r) => (r.people.low === r.people.high ? String(r.people.mid) : r.people.mid + ' (' + r.people.low + '–' + r.people.high + ')');
  function reason(sc, p) {
    const r = p.r, m = p.model, bits = [];
    if (p.llama) bits.push('Only on llama.cpp here: about ' + peopleText(r) + ' at ' + fmtK(sc.est.context) + ' if it batched like vLLM, '
      + 'but llama.cpp served 2–24× fewer people in the spike, so not your ' + sc.people);
    else if (p.one) bits.push('A card for one person: about ' + peopleText(r) + ' at ' + fmtK(sc.est.context) + ' on paper, '
      + 'but never measured with a group, so not your ' + sc.people);
    else bits.push((p.covers ? 'Covers your ' + sc.people + ' with ' : 'Serves ') + peopleText(r) + ' at ' + fmtK(sc.est.context) + ', ' + r.confidence
      + (p.covers ? '' : shortOf(sc, r)));
    const feats = [];
    if (m.tools && (sc.need.tools || sc.need.coding)) feats.push('tool calling');
    if (m.vision) feats.push('reads images');
    if (feats.length) bits.push(feats.join(', '));
    if (sc.use === 'computer' && !m.vision) bits.push('cannot read images: the Image box and Describe a picture need another model');
    const gate = spikeGate(m), ce = sc.need.coding && codingEvidence(m), s = score(m);
    if (gate != null) bits.push(gate + '/28 on the spike\'s coding and reasoning check');
    else if (ce) bits.push(ce.benchmark + ' ' + ce.score + (ce.vendor_reported ? ' (vendor)' : ''));
    else if (s != null) bits.push('BenchLM index ' + s);
    if (sc.est.budget !== 'single_user' && p.hw.budget && !p.hw.budget.farm_with_ocr_gib && !p.hw.budget.farm_gib) bits.push('the OCR model needs another box');
    if (r.checkpoint.gguf && !p.llama) bits.push('runs on llama.cpp');
    return bits.join('; ') + '.';
  }
  function whyNotText(sc, id, p) {
    const name = POPULAR[id];
    if (!p) return 'Why not ' + name + '? No model that meets these needs fits it.';
    return 'Why not ' + name + '? The best fit there, ' + modelName(p.model) + ', serves ' + peopleText(p.r) + ' at ' + fmtK(sc.est.context)
      + shortOf(sc, p.r) + '.';
  }
  // Why a pair falls short: under the head count, or over it with no room to spare.
  const shortOf = (sc, r) => (r.people.low >= sc.people ? ': your ' + sc.people + ' with no room to spare'
    : ': not your ' + sc.people + ' (limited by ' + (BIND[r.binding] || r.binding) + ')');

  // ---- This farm: the catalog entry for the box's GPU (snapshot host.gpu, host.vramGb), and its served model.
  // exact = the name matched with the card's memory (a 16 GB "4070 Ti SUPER" or an 8 GB laptop 4070 is not the 12 GB
  // card); else the largest single box with no more memory, as a rough stand-in.
  const NAMES = [[/GB10|DGX Spark/i, 'dgx-spark'], [/RTX PRO 6000.*Max-?Q/i, 'rtx-pro-6000-maxq'], [/RTX PRO 6000/i, 'rtx-pro-6000-ws'],
    [/RTX PRO 5500/i, 'rtx-pro-5500'], [/RTX PRO 5000/i, (gb) => (gb > 60 ? 'rtx-pro-5000-72' : 'rtx-pro-5000-48')],
    [/RTX 5090/i, 'rtx-5090'], [/RTX 4080/i, 'rtx-4080'], [/RTX 4070/i, 'rtx-4070']];
  function matchHardware(catalog, host) {
    const gpu = (host && host.gpu) || '', gb = (host && host.vramGb) || 0;
    if (!gpu || /unknown/i.test(gpu)) return null;
    for (const [re, id] of NAMES) if (re.test(gpu)) {
      const hid = typeof id === 'function' ? id(gb) : id, h = catalog.hardware.find((x) => x.id === hid);
      if (gb && h && h.kind === 'pcie-card' && Math.abs(gb - h.memory_gib_visible) > 2) break;
      return { id: hid, exact: true, gpu, vramGb: gb };
    }
    const near = catalog.hardware.filter((h) => h.kind !== 'cluster' && h.memory_gib_visible <= gb + 1)
      .sort((a, b) => b.memory_gib_visible - a.memory_gib_visible)[0];
    return near ? { id: near.id, exact: false, gpu, vramGb: gb } : null;
  }
  const compact = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  function matchModel(catalog, served) {
    const s = compact(served); if (s.length < 4) return null;
    let hit = null, len = 0;
    for (const m of catalog.models) {
      for (const c of [m.id, m.name.replace(/\s*\(.*$/, '')].concat(m.checkpoints.map((k) => k.repo.split('/').pop()))) {
        const cc = compact(c);
        if (cc.length > len && (s.includes(cc) || (cc.includes(s) && s.length >= 8))) { hit = m; len = cc.length; }
      }
    }
    return hit;
  }

  const api = { USES, SCENARIOS, scenario, card, recommend, unmet, score, matchHardware, matchModel, SHORT, hwName, modelName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Scenarios = api;
  else root.Scenarios = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
