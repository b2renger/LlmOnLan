// One person asks for a whole file back with one rename, thinking off: an answer that mostly repeats its prompt, the
// shape of a code edit in LOL Vibe (HyperQwen evaluation, night n° 10). Prints first-token time, decode speed and
// whether the answer is right (the new name everywhere, the old one nowhere, the rest of the file kept).
//   node hq_edit.mjs <server root URL, no /v1> <label> [model] [rounds]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , url, label, model = 'qwen38', roundsArg = '3'] = process.argv;
if (!label) { console.log('usage: node hq_edit.mjs <url> <label> [model] [rounds]'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const src = fs.readFileSync(path.join(repo, 'shell/renderer/chat/render/page.mjs'), 'utf8');
const prompt = `Here is page.mjs:\n\n\`\`\`js\n${src}\n\`\`\`\n\nRename the function blockOf to blockAt everywhere in this file. Answer with the whole file, changed, in one code block, and nothing else.`;
const want = src.split('blockOf').join('blockAt');

const runs = [];
for (let i = 0; i < Number(roundsArg); i++) {
    const t0 = performance.now();
    let first = 0; let text = ''; let usage = null;
    const res = await fetch(`${url.replace(/\/+$/, '')}/v1/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, max_tokens: 6000, temperature: 0,
            chat_template_kwargs: { enable_thinking: false }, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) { console.log(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let k;
        while ((k = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
            if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
            const j = JSON.parse(line.slice(5));
            if (j.usage) usage = j.usage;
            const d = j.choices && j.choices[0] && j.choices[0].delta;
            if (d && d.content) { if (!first) first = performance.now(); text += d.content; }
        }
    }
    const end = performance.now();
    const n = usage ? usage.completion_tokens : 0;
    const body = (/```[a-z]*\n([\s\S]*?)```/.exec(text) || [])[1] || text;
    const right = !/blockOf/.test(body) && /blockAt/.test(body) && body.trim() === want.trim();
    runs.push({ ttft: (first - t0) / 1000, tokens: n, tps: n > 1 ? (n - 1) / ((end - first) / 1000) : 0, right, close: !/blockOf/.test(body) && /blockAt/.test(body) });
    console.log(`[edit] ${label} round ${i + 1}: first token ${((first - t0) / 1000).toFixed(2)} s, ${n} tokens, ${runs.at(-1).tps.toFixed(1)} tok/s, exact copy ${right}, renamed ${runs.at(-1).close}`);
}
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const out = { label, model, at: new Date().toISOString(), prompt_chars: prompt.length, runs, median_tps: med(runs.map((r) => r.tps)) };
fs.writeFileSync(path.join(repo, 'docs/spike/results', `hq-${label}-edit.json`), JSON.stringify(out, null, 1));
console.log(`[edit] ${label}: median ${out.median_tps.toFixed(1)} tok/s`);
