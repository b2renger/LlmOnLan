// CONTEXT_128K_PLAN step 3: a ~100k-token document in a real Open WebUI 0.13.3, three questions in one chat, the time
// to the first word of each. Run once with Open WebUI started RAG_SYSTEM_CONTEXT=false, once =true.
//   node owui_doc_turns.mjs <owui base, e.g. http://127.0.0.1:8197> <model> <label> <document .txt> <answers .json>
import { readFileSync, writeFileSync } from 'node:fs';
const [base, model, label, docPath, answersPath] = process.argv.slice(2);
const answers = JSON.parse(readFileSync(answersPath, 'utf8'));   // [{id, code}] three pupils, early / middle / late
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tok = (await (await fetch(`${base}/api/v1/auths/signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: '', password: '' }) })).json()).token;
const H = { authorization: `Bearer ${tok}` };
const fd = new FormData();
fd.append('file', new Blob([readFileSync(docPath)], { type: 'text/plain' }), 'lockers.txt');
const up = await (await fetch(`${base}/api/v1/files/`, { method: 'POST', headers: H, body: fd })).json();
if (!up.id) throw new Error('upload: ' + JSON.stringify(up).slice(0, 300));
for (let i = 0; i < 120; i++) {   // wait for Open WebUI to finish reading the file
    const st = await (await fetch(`${base}/api/v1/files/${up.id}/process/status`, { headers: H })).json().catch(() => ({}));
    if (!st.status || st.status === 'completed') break;
    if (st.status === 'failed') throw new Error('file processing failed: ' + JSON.stringify(st));
    await sleep(1000);
}
const files = [{ type: 'file', id: up.id, name: 'lockers.txt', collection_name: `file-${up.id}`, status: 'uploaded' }];

// The client's own system prompt, the date line it writes once (renderer/app.js:617), as Open WebUI renders it.
const messages = [{ role: 'system', content: 'Today is Friday 2026-11-20.' }]; const out = [];
for (const [n, a] of answers.entries()) {
    messages.push({ role: 'user', content: `In the locker list, what is the code of the locker of pupil P-${a.id}? Answer with the four digits only.` });
    const t0 = Date.now(); let first = null; let text = '';
    const r = await fetch(`${base}/api/chat/completions`, {
        method: 'POST', headers: { ...H, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, files, stream: true, params: { temperature: 0.6, top_p: 0.95 },
            chat_template_kwargs: { enable_thinking: false } }),
    });
    if (!r.ok) throw new Error(`turn ${n + 1}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    const dec = new TextDecoder();
    for await (const chunk of r.body) {
        for (const line of dec.decode(chunk, { stream: true }).split('\n')) {
            if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
            try { const d = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content; if (d) { if (first === null) first = Date.now() - t0; text += d; } } catch { /* a partial line */ }
        }
    }
    const total = Date.now() - t0;
    messages.push({ role: 'assistant', content: text });
    out.push({ turn: n + 1, firstWordS: first / 1000, totalS: total / 1000, expected: a.code, got: text.trim().slice(0, 30), ok: (text.match(/\d{4}/) || [])[0] === a.code });
    console.log(`[${label}] turn ${n + 1}: first word ${(first / 1000).toFixed(2)} s, ${out.at(-1).ok ? 'right' : 'WRONG (' + text.trim().slice(0, 30) + ')'}`);
}
writeFileSync(`${label}.json`, JSON.stringify({ label, model, base, file: up.id, turns: out }, null, 1));
