// A few end-to-end cases through the public API (node calibrate/test_cases.js). Output is pasted into estimator-validation.md.
const E = require('../estimator.js');
E.init(require('../catalog.json'), require('../measured.json'));
const t = r => `${r.low}/${r.mid}/${r.high}`, f = (r, d = 1) => `${r.mid.toFixed(d)} (${r.low.toFixed(d)}-${r.high.toFixed(d)})`;
function show(label, hw, model, opts) {
  const r = E.estimate(hw, model, opts), m = r.memory;
  console.log(`\n# ${label}\n  ${hw} x ${model} ${JSON.stringify(opts)}`);
  console.log(`  confidence ${r.confidence} | cluster ${r.cluster} x${r.copies} | ${r.engine} | checkpoint ${r.checkpoint.format} (${r.checkpoint.weightsGiB.toFixed(1)} GiB)`);
  console.log(`  fits ${r.fits} | people every ${t(r.peopleEvery)} steady ${t(r.peopleSteady)} (low/mid/high) | binding: ${r.binding}`);
  if (r.singleUserTps) console.log(`  one person: decode ${f(r.singleUserTps)} tok/s, cold prompt ${f(r.coldPromptS)} s, follow-up TTFT ${f(r.turnS, 2)} s, full answer ${f(r.answerS)} s`);
  console.log(`  memory GiB (per copy): visible ${m.visibleGiB}, budget ${m.budgetGiB.toFixed(1)} = weights ${m.weightsGiB.toFixed(1)} + KV pool ${m.kvPoolGiB.toFixed(1)}; runtime ${m.runtimeGiB.toFixed(1)}, kept free ${m.reservedGiB.toFixed(1)}`);
  console.log(`  per person MiB: KV ${m.perPersonMiB.kv.toFixed(0)} + state ${m.perPersonMiB.state.toFixed(0)} = ${m.perPersonMiB.total.toFixed(0)} (block ${m.block} tokens) | max context one person ${r.maxContextOnePerson.tokens} (native ${r.maxContextOnePerson.native}; ${r.maxContextOnePerson.extended} with context extension)`);
  if (r.limits) console.log('  limits (central):', JSON.stringify(r.limits));
  if (r.measured) console.log(`  measured: ${r.measured.config} ${r.measured.profile} every ${r.measured.every && r.measured.every.label} steady ${r.measured.steady && r.measured.steady.label}`);
  for (const n of r.notes) console.log('  note:', n);
  return r;
}
show('Measured cell: PRO 6000, Qwen3.6, 32k, farm budget (50 GiB pool, OCR on the card)', 'rtx-pro-6000-ws', 'qwen3.6-35b-a3b', { context: 30200 });
show('Measured cell: one Spark, Qwen3.6, 32k', 'dgx-spark', 'qwen3.6-35b-a3b', { context: 30200 });
show('Calibrated: PRO 5000 72 GB, Qwen3.6, 32k (ESTIMATES 2026-10-05 said 59-69 / 65-69)', 'rtx-pro-5000-72', 'qwen3.6-35b-a3b', { context: 32768 });
show('Thinking x4 (1,024-token replies), PRO 6000, Qwen3.6, 32k, steady', 'rtx-pro-6000-ws', 'qwen3.6-35b-a3b', { context: 32768, thinking: 4, mode: 'steady' });
show('bf16 KV, PRO 6000, Qwen3.6, 64k', 'rtx-pro-6000-ws', 'qwen3.6-35b-a3b', { context: 65536, kvDtype: 'bf16' });
show('Two Sparks, Qwen3.6 (fits one Spark -> two copies)', 'dgx-spark-x2', 'qwen3.6-35b-a3b', { context: 32768 });
show('Two Sparks, Qwen3.5-397B, single-user budget (TP=2)', 'dgx-spark-x2', 'qwen3.5-397b-a17b', { context: 32768, budget: 'single_user' });
show('Two Sparks, DeepSeek-V4-Flash, single-user budget', 'dgx-spark-x2', 'deepseek-v4-flash-0731', { context: 65536, budget: 'single_user' });
show('One Spark, gpt-oss-120b, 32k', 'dgx-spark', 'gpt-oss-120b', { context: 32768 });
show('PRO 6000, gpt-oss-120b, 32k (no OCR on the card)', 'rtx-pro-6000-ws', 'gpt-oss-120b', { context: 32768, budget: 'farm_no_ocr' });
show('One Spark, GLM-5.3-Flash, single user', 'dgx-spark', 'glm-5.3-flash', { context: 32768, budget: 'single_user' });
show('PRO 6000, Kimi K2.6 (does not fit)', 'rtx-pro-6000-ws', 'kimi-k2.6', { context: 32768 });
console.log('\n# curve(): speed per person as people join, PRO 6000 vs Spark, Qwen3.6 at 32k');
for (const hw of ['rtx-pro-6000-ws', 'dgx-spark']) console.log(' ', hw, E.curve(hw, 'qwen3.6-35b-a3b', { context: 32768 }, [1, 8, 16, 32, 64, 128])
  .map(p => `N=${p.N}: ${p.decodeTps.toFixed(1)} tok/s, first-turn TTFT ${p.firstTurnTtftS.toFixed(1)} s`).join(' | '));
console.log('\n# fitTable(): what fits the two Sparks for one person (TP=2, single-user budget 220 GiB)');
const ft = E.fitTable().filter(r => r.hw === 'dgx-spark-x2'), c = x => (x.fits ? (x.bits <= 3 ? '<=3-bit ' : (x.bits + '-bit').padEnd(8)) + x.weightsGiB.toFixed(0).padStart(5) + ' GiB, max ctx ' + String(x.maxContext).padStart(7) : 'no' + ' '.repeat(30));
for (const r of ft) console.log(`  ${r.model.padEnd(31)} alone (220 GiB): ${c(r.alone)} | farm (168 GiB): ${c(r.farm)}`);
