// Fit of tonight's candidates, by the farm's own Automatic rule (vllm.js poolGib), calibrated on measured models.
const GiB = 1024 ** 3;
const PRO = { name: 'PRO 6000', total: 95.59, desktop: 1.4 };
const SPARK = { name: 'Spark', total: 121, desktop: 6 };   // unified: OS + min free taken as ~6 GiB (estimate)
const pool = (box, w, farm) => (box.total - box.desktop) - (farm ? 0.08 * box.total + 9 + 1.5 : 0.02 * box.total) - 4 - w;
// kv: bytes a token (fp8 cache); fixed: bytes a person (recurrent state or sliding windows). Two cases where layouts are unsure.
const M = [
  { id: 'Qwen3.6 35B-A3B (ref)', w: 20.37, kv: 10240, fixed: 64389120, act: 3, note: 'measured 64 @64k whole card (60 GiB pool), 48 every turn' },
  { id: 'Gemma 4 26B-A4B (ref)', w: 18.13, kv: 37464, fixed: 104857600, act: 3.8, note: 'kv MEASURED; measured 20 @64k (60 GiB pool)' },
  { id: 'Nemotron 3.5 Super VL NVFP4', w: 75.1e9 / GiB, kv: 3584, fixed: 72 * 2 ** 20, act: 12, note: '7 attn layers x2 kv x128; mamba state 72 MiB (bf16)' },
  { id: '  same, mamba state fp32', w: 75.1e9 / GiB, kv: 3584, fixed: 144 * 2 ** 20, act: 12, note: 'if vLLM keeps the SSM state in fp32' },
  { id: 'Kolibri-1 FP8 (official)', w: 78.9e9 / GiB, kv: 10240, fixed: 40 * 513 * 1024, act: 3.46, note: 'windows honoured: 10 full layers' },
  { id: '  same, every layer pays', w: 78.9e9 / GiB, kv: 51200, fixed: 0, act: 3.46, note: 'as Gemma 4 measured under vLLM' },
  { id: 'Kolibri-1 NVFP4-W4A16 (3rd party)', w: 47.4e9 / GiB, kv: 10240, fixed: 40 * 513 * 1024, act: 3.46, note: 'windows honoured' },
  { id: '  same, every layer pays', w: 47.4e9 / GiB, kv: 51200, fixed: 0, act: 3.46, note: '' },
  { id: 'gpt-oss-120b MXFP4', w: 60.77, kv: 18432, fixed: 2359296, act: 5.1, note: 'no pictures' },
  { id: 'Qwen3-Coder-Next FP8', w: 74.86, kv: 12288, fixed: 77266944, act: 3, note: 'no pictures; code' },
  { id: 'Ripple-65B NVFP4 (queued)', w: 57.21e9 / GiB, kv: 16 * 2 * 8 * 128, fixed: 64 * 1024 * 2048, act: 65, note: 'dense; needs a vLLM nightly' },
];
const ppl = (p, m, ctx) => (p <= 0 ? 0 : Math.floor((p * GiB) / (m.kv * ctx + m.fixed)));
const rows = [];
for (const m of M) {
  const r = [m.id.padEnd(36), m.w.toFixed(1).padStart(5)];
  for (const [box, farm] of [[PRO, true], [PRO, false], [SPARK, true]]) {
    const p = pool(box, m.w, farm);
    r.push(`${p.toFixed(0).padStart(4)} GiB: ${String(ppl(p, m, 32768)).padStart(4)} @32k ${String(ppl(p, m, 65536)).padStart(4)} @64k`);
  }
  r.push(`Spark ~${Math.round(273 / (m.act * (m.w / (m.act > 20 ? 65 : 1)) ** 0 * 0.6))} tok/s cap`);
  rows.push(r.join(' | ') + '   ' + m.note);
}
console.log('model'.padEnd(36), 'GiB  | PRO as a farm (OCR+search on)        | PRO whole card                       | Spark as a farm');
console.log(rows.join('\n'));
