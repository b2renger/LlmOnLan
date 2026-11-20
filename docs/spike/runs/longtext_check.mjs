#!/usr/bin/env node
// A long-text check (QWEN38_FP16_STATE_PLAN step 1.2, and the 128k default of 2026-11-19): one document of about N
// tokens made of numbered records, then questions about records spread evenly from its start to its end, each asked
// once after the whole document. The same seed gives the same document and questions, so two servers compare like for
// like. Thinking off, the farm's sampling (temperature 0.6, top_p 0.95), as the quality gate.
//   node longtext_check.mjs <base /v1 URL> <model> <tokens> <label> [samples=20] [concurrency=4]
// Writes docs/spike/results/<label>-longtext-<tokens>.json and prints correct/total. A document longer than the
// server's window prints the server's refusal, as a person's chat would get it.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [base, model, tokensArg, label, samplesArg = '20', concArg = '4'] = process.argv.slice(2);
if (!base || !model || !tokensArg || !label) { console.error('usage: longtext_check.mjs <base /v1 URL> <model> <tokens> <label> [samples] [concurrency]'); process.exit(2); }
const target = Number(tokensArg), samples = Number(samplesArg), conc = Number(concArg);
const root = base.replace(/\/v1\/?$/, '');

let s = 42;   // mulberry32: the same records on every run
const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ROOMS = ['A', 'B', 'C', 'D', 'E', 'F'];
const used = new Set();
function record(n) {
    let id; do { id = 10000 + Math.floor(rnd() * 90000); } while (used.has(id)); used.add(id);
    const code = String(1000 + Math.floor(rnd() * 9000));
    const room = `${ROOMS[Math.floor(rnd() * ROOMS.length)]}-${10 + Math.floor(rnd() * 40)}`;
    return { id, code, text: `Locker ${String(n).padStart(4, '0')}: pupil P-${id}, room ${room}, code ${code}.` };
}
const tokenize = async (prompt) => {
    const r = await fetch(`${root}/tokenize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, prompt }) });
    if (!r.ok) throw new Error(`tokenize: HTTP ${r.status} ${await r.text()}`);
    return (await r.json()).count;
};

// Size the document from a sample of records, then build it.
const probe = Array.from({ length: 200 }, (_, i) => record(i + 1));
const perRecord = (await tokenize(probe.map((r) => r.text).join('\n'))) / probe.length;
const n = Math.max(samples, Math.floor((target - 120) / perRecord));
const records = [...probe, ...Array.from({ length: Math.max(0, n - probe.length) }, (_, i) => record(probe.length + i + 1))].slice(0, n);
const doc = records.map((r) => r.text).join('\n');
const ask = (r) => `Here is the school's locker list.\n\n${doc}\n\nQuestion: what is the code of the locker of pupil P-${r.id}? Answer with the four digits only.`;
const promptTokens = await tokenize(ask(records[0])).catch((e) => { console.log(`[${label}] ${e.message.slice(0, 300)}`); return null; });
const picks = Array.from({ length: samples }, (_, k) => Math.floor(((k + 0.5) / samples) * records.length));
console.log(`[${label}] ${records.length} records, ~${promptTokens} prompt tokens, ${samples} questions, ${conc} at a time`);

const out = [];
async function one(k) {
    const i = picks[k], r = records[i], t0 = Date.now();
    const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: ask(r) }], max_tokens: 24, temperature: 0.6, top_p: 0.95,
            chat_template_kwargs: { enable_thinking: false } }),
    });
    const secs = (Date.now() - t0) / 1000;
    if (!res.ok) { const body = await res.text(); out[k] = { depth: i / records.length, expected: r.code, status: res.status, error: body.slice(0, 400), secs }; return; }
    const j = await res.json();
    const got = String(j.choices?.[0]?.message?.content ?? '').trim();
    out[k] = { depth: +(i / records.length).toFixed(3), expected: r.code, got: got.slice(0, 40), ok: (got.match(/\d{4}/) || [])[0] === r.code, secs };
}
let next = 0;
await Promise.all(Array.from({ length: Math.min(conc, samples) }, async () => { while (next < samples) await one(next++); }));

const ok = out.filter((x) => x.ok).length, errors = out.filter((x) => x.status);
if (errors.length) console.log(`[${label}] refused ${errors.length}: HTTP ${errors[0].status} ${errors[0].error}`);
console.log(`[${label}] ${ok}/${samples} right; wrong at depths ${out.filter((x) => !x.ok && !x.status).map((x) => x.depth).join(', ') || 'none'}`);
const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'results', `${label}-longtext-${target}.json`);
writeFileSync(file, JSON.stringify({ label, model, base, target, promptTokens, records: records.length, samples, ok, results: out }, null, 1));
console.log(`[${label}] → ${file}`);
