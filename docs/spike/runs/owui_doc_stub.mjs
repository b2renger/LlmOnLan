// A stand-in for the farm, for CONTEXT_128K_PLAN step 3 on the client's real path (no BYPASS_EMBEDDING_AND_RETRIEVAL):
// it answers /v1/models, /v1/embeddings (fixed vectors: full-context mode reads the whole collection, so similarity
// does not matter) and /v1/chat/completions (a fixed short reply), and logs each chat request's messages with a hash
// of each one's content, to see whether the document's message is byte-identical from turn to turn.
//   node owui_doc_stub.mjs <port> <log file>
import http from 'node:http';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
const [port, logFile] = process.argv.slice(2);
const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') : {};
        const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
        if (/\/models$/.test(req.url)) return json({ object: 'list', data: [{ id: 'qwen36', object: 'model', owned_by: 'stub' }] });
        if (/\/embeddings$/.test(req.url)) {
            const inputs = Array.isArray(body.input) ? body.input : [body.input];
            appendFileSync(logFile, `${new Date().toISOString()} embeddings x${inputs.length}\n`);
            return json({ object: 'list', model: body.model, data: inputs.map((_, i) => ({ object: 'embedding', index: i, embedding: Array.from({ length: 384 }, (_, k) => ((k % 7) + 1) / 10) })) });
        }
        if (/chat\/completions$/.test(req.url)) {
            const msgs = (body.messages || []).map((m, i) => {
                const t = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                return `${i}:${m.role}:${t.length}:${h(t)}${t.includes('Locker 0001:') ? ':DOC' : ''}`;
            });
            appendFileSync(logFile, `${new Date().toISOString()} chat ${msgs.join(' | ')}\n`);
            if (!body.stream) return json({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: '0000' }, finish_reason: 'stop' }] });
            res.writeHead(200, { 'content-type': 'text/event-stream' });
            res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '0000' } }] })}\n\n`);
            res.write(`data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
            return res.end('data: [DONE]\n\n');
        }
        res.writeHead(404); res.end('{}');
    });
}).listen(Number(port), '127.0.0.1', () => console.log(`stub on ${port}`));
