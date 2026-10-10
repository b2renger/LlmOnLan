// Functional checks against an OpenAI-compatible server (2026-10-09, Gemma 4 12B and Qwen3-Omni on vLLM): one
// stream (TTFT, tok/s), a picture, a tool call, sound in a chat message (French, English), and, with TRANSCRIBE=1,
// /v1/audio/transcriptions. Node 18+, no dependency.
//   [THINK=on|off] [TRANSCRIBE=1] node probe.js <base, e.g. http://127.0.0.1:8100/v1> <model> <out.json>
// media/: shapes.png (a red circle, a blue square, "LOL 42", drawn with System.Drawing) and two 16 kHz mono WAVs
// spoken by Windows' own voices: fr.wav (Hortense: "Bonjour. Je voudrais réserver la salle de réunion pour jeudi à
// quinze heures, pour six personnes.") and en.wav (Zira: "Hello. Please order three boxes of blue markers and send
// the invoice to the design school.").
const fs = require('fs');
const path = require('path');
const [base, model, out] = process.argv.slice(2);
const media = path.join(__dirname, 'media');
const b64 = (f) => fs.readFileSync(path.join(media, f)).toString('base64');
const results = { model, base, at: new Date().toISOString(), checks: [] };

async function chat(body, label) {
    const t0 = performance.now();
    const r = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true, stream_options: { include_usage: true }, ...body }) });
    if (!r.ok) { const e = { label, ok: false, status: r.status, error: (await r.text()).slice(0, 600) }; results.checks.push(e); console.log(JSON.stringify(e)); return e; }
    let first = null; let last = null; let text = ''; let reasoning = ''; let usage = null; const calls = {};
    const dec = new TextDecoder(); let buf = '';
    for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith('data:')) continue;
            const d = line.slice(5).trim();
            if (d === '[DONE]') continue;
            const j = JSON.parse(d);
            if (j.usage) usage = j.usage;
            const delta = j.choices && j.choices[0] && j.choices[0].delta;
            if (!delta) continue;
            const any = delta.content || delta.reasoning || delta.reasoning_content || delta.tool_calls;
            if (any) { if (first == null) first = performance.now(); last = performance.now(); }
            if (delta.content) text += delta.content;
            if (delta.reasoning || delta.reasoning_content) reasoning += delta.reasoning || delta.reasoning_content;
            for (const tc of delta.tool_calls || []) {
                const c = calls[tc.index] || (calls[tc.index] = { name: '', args: '' });
                if (tc.function && tc.function.name) c.name += tc.function.name;
                if (tc.function && tc.function.arguments) c.args += tc.function.arguments;
            }
        }
    }
    const n = usage ? usage.completion_tokens : null;
    const res = {
        label, ok: true, ttft_s: first ? +((first - t0) / 1000).toFixed(3) : null,
        decode_tps: n && first && last > first ? +((n - 1) / ((last - first) / 1000)).toFixed(1) : null,
        prompt_tokens: usage ? usage.prompt_tokens : null, completion_tokens: n,
        text: text.trim().slice(0, 800), reasoning_chars: reasoning.length, tool_calls: Object.values(calls),
    };
    results.checks.push(res); console.log(JSON.stringify(res));
    return res;
}

async function transcribe(file, language) {
    const fd = new FormData();
    fd.append('file', new Blob([fs.readFileSync(path.join(media, file))], { type: 'audio/wav' }), file);
    fd.append('model', model);
    if (language) fd.append('language', language);
    const t0 = performance.now();
    const r = await fetch(`${base}/audio/transcriptions`, { method: 'POST', body: fd });
    const body = await r.text();
    const res = { label: `transcriptions ${file}${language ? ` (${language})` : ''}`, ok: r.ok, status: r.status, seconds: +((performance.now() - t0) / 1000).toFixed(2), text: body.slice(0, 600) };
    results.checks.push(res); console.log(JSON.stringify(res));
}

(async () => {
    const think = process.env.THINK ? { chat_template_kwargs: { enable_thinking: process.env.THINK === 'on' } } : {};
    await chat({ messages: [{ role: 'user', content: 'Write three short sentences about the sea.' }], max_tokens: 64, ...think }, 'warm-up');
    await chat({ messages: [{ role: 'user', content: 'Explain in about 300 words how a bicycle gear system works.' }], max_tokens: 512, ...think }, 'one stream (512 tokens)');
    await chat({ messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64('shapes.png')}` } },
        { type: 'text', text: 'What shapes, colours and text are in this picture? Answer in one sentence.' }] }], max_tokens: 200, ...think }, 'picture');
    await chat({
        messages: [{ role: 'user', content: 'What is the weather in Lyon right now? Use the tool.' }], max_tokens: 400, ...think,
        tools: [{ type: 'function', function: { name: 'get_weather', description: 'Current weather for a city', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }],
        tool_choice: 'auto',
    }, 'tool call');
    for (const [f, fmt] of [['fr.wav', 'wav'], ['en.wav', 'wav']]) {
        await chat({ messages: [{ role: 'user', content: [
            { type: 'input_audio', input_audio: { data: b64(f), format: fmt } },
            { type: 'text', text: 'Transcribe this audio word for word, in the language it is spoken in. Then, on a new line, say in English what the speaker wants.' }] }], max_tokens: 300, ...think }, `sound in a message ${f}`);
    }
    if (process.env.TRANSCRIBE) {
        await transcribe('fr.wav', 'fr');
        await transcribe('en.wav', 'en');
        await transcribe('fr.wav', null);
    }
    fs.writeFileSync(out, JSON.stringify(results, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
