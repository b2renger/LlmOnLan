// Does drafting change the answers? (VLLM_DRAFT_PLAN, night n° 10.) Speculative decoding with rejection sampling should
// give the model's own answers; this counts it. Three questions with one right answer each, asked many times with
// thinking on and the model's own sampling, 4 at a time; run once without drafting and once with, and compare the rates.
//   node hq_same.mjs <server root URL, no /v1> <model> <label> [samples per question]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , url, model, label, nArg = '30'] = process.argv;
if (!label) { console.log('usage: node hq_same.mjs <url> <model> <label> [n]'); process.exit(2); }
const Q = [
    { id: 'train', text: 'A train leaves at 14:35 and the trip takes 2 h 50 min. When does it arrive? Answer in one sentence.', right: /17[:h.]25/ },
    { id: 'pens', text: 'Pens cost 2 euros for 3. How much do 12 pens cost? Answer with the amount only.', right: /\b8\b/ },
    { id: 'mult', text: 'What is 37 × 43? Answer with the number only.', right: /\b1591\b/ },
];
const ask = async (q) => {
    const r = await fetch(`${url.replace(/\/+$/, '')}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'user', content: q.text }] }) });
    const j = await r.json(); const m = j.choices?.[0]?.message || {};
    return { content: String(m.content || ''), thinking: String(m.reasoning_content || m.reasoning || '').length };
};
const out = { label, model, at: new Date().toISOString(), n: Number(nArg), questions: {} };
for (const q of Q) {
    const jobs = Array.from({ length: Number(nArg) }, () => q);
    const res = [];
    for (let i = 0; i < jobs.length; i += 4) res.push(...await Promise.all(jobs.slice(i, i + 4).map(ask)));
    const right = res.filter((r) => q.right.test(r.content)).length;
    const answers = {}; for (const r of res) { const k = r.content.trim().slice(0, 40); answers[k] = (answers[k] || 0) + 1; }
    out.questions[q.id] = { right, of: res.length, thinkingMedian: res.map((r) => r.thinking).sort((a, b) => a - b)[res.length >> 1], answers };
    console.log(`[same] ${label} ${q.id}: ${right}/${res.length} right; thinking median ${out.questions[q.id].thinkingMedian} chars; ${JSON.stringify(Object.entries(answers).sort((a, b) => b[1] - a[1]).slice(0, 4))}`);
}
const here = path.dirname(fileURLToPath(import.meta.url));
fs.writeFileSync(path.join(here, '..', 'results', `hq-${label}-same.json`), JSON.stringify(out, null, 1));
