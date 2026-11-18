// Streaming under drafting (VLLM_DRAFT_PLAN, night n° 10): with MTP each streamed chunk can carry several tokens, and
// the reasoning and tool-call parsers must still split them right. As Open WebUI and LOL Vibe's agent read a reply:
//   thinking  a question with thinking on: the thinking comes as reasoning_content, the answer as content, and no
//             <think> / </think> leaks into the answer
//   tools     a question that needs a tool, streamed: the call's arguments join into valid JSON, no tool-call markup
//             (<tool_call>, <function=) leaks into the text
//   node hq_stream.mjs <farm or server root URL, no /v1> <model> [rounds]
const [, , url, model, roundsArg = '5'] = process.argv;
if (!model) { console.log('usage: node hq_stream.mjs <url> <model> [rounds]'); process.exit(2); }
const base = url.replace(/\/+$/, '');

async function stream(body) {
    const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true, ...body }) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const dec = new TextDecoder(); let buf = ''; let content = ''; let reasoning = ''; const calls = []; let chunks = 0; let finish = null;
    for await (const part of res.body) {
        buf += dec.decode(part, { stream: true });
        let k;
        while ((k = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, k).trim(); buf = buf.slice(k + 1);
            if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
            const c = JSON.parse(line.slice(5)).choices?.[0]; if (!c) continue;
            chunks++; if (c.finish_reason) finish = c.finish_reason;
            const d = c.delta || {};
            if (d.content) content += d.content;
            if (d.reasoning_content || d.reasoning) reasoning += d.reasoning_content || d.reasoning;
            for (const t of d.tool_calls || []) {
                const at = calls[t.index ?? 0] ||= { name: '', args: '' };
                if (t.function?.name) at.name += t.function.name;
                if (t.function?.arguments) at.args += t.function.arguments;
            }
        }
    }
    return { content, reasoning, calls, chunks, finish };
}

const TOOLS = [{ type: 'function', function: { name: 'get_weather', description: 'The weather now in a city', parameters: { type: 'object', properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['celsius', 'fahrenheit'] } }, required: ['city', 'unit'] } } }];
let bad = 0;
for (let i = 1; i <= Number(roundsArg); i++) {
    const t = await stream({ max_tokens: 3000, messages: [{ role: 'user', content: 'A train leaves at 14:35 and the trip takes 2 h 50 min. When does it arrive? Answer in one sentence.' }] });
    const tOk = t.reasoning.length > 0 && t.content.trim().length > 0 && !/<\/?think>/.test(t.content) && t.finish === 'stop';
    const w = await stream({ max_tokens: 3000, tools: TOOLS, messages: [{ role: 'user', content: 'What is the weather in Lyon right now, in celsius? Use the tool.' }] });
    let args = null; try { args = JSON.parse(w.calls[0]?.args || 'x'); } catch { /* bad */ }
    const wOk = w.calls.length === 1 && w.calls[0].name === 'get_weather' && args && /lyon/i.test(args.city) && args.unit === 'celsius'
        && !/<tool_call>|<function=|<parameter=/.test(w.content) && w.finish === 'tool_calls';
    if (!tOk || !wOk) bad++;
    console.log(`[stream] round ${i}: thinking ${tOk ? 'ok' : 'BAD'} (${t.chunks} chunks, ${t.reasoning.length} chars of thinking, answer: ${JSON.stringify(t.content.trim().slice(0, 80))}) · tool ${wOk ? 'ok' : 'BAD'} (${w.chunks} chunks, ${JSON.stringify(w.calls)}${w.content.trim() ? `, text: ${JSON.stringify(w.content.trim().slice(0, 80))}` : ''}, ${w.finish})`);
}
console.log(`[stream] ${bad ? `${bad} round(s) BAD` : 'all rounds ok'}`);
process.exit(bad ? 1 : 0);
