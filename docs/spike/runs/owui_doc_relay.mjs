// A relay between Open WebUI and the trial vLLM that logs WHERE a document lands in each chat request:
// for every message, its role, its size, and whether it holds the locker list (the marker "Locker 0001:").
//   node owui_doc_relay.mjs <listen port> <upstream port> <log file>
import http from 'node:http';
import { appendFileSync } from 'node:fs';
const [listen, up, logFile] = process.argv.slice(2);
http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (req.method === 'POST' && /chat\/completions/.test(req.url)) {
            try {
                const j = JSON.parse(body.toString('utf8'));
                const msgs = (j.messages || []).map((m, i) => {
                    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                    return `${i}:${m.role}:${text.length}${text.includes('Locker 0001:') ? ':DOC@' + text.indexOf('Locker 0001:') : ''}`;
                });
                appendFileSync(logFile, `${new Date().toISOString()} ${msgs.join(' | ')}\n`);
            } catch (e) { appendFileSync(logFile, `unparsed: ${e.message}\n`); }
        }
        const p = http.request({ host: '127.0.0.1', port: Number(up), path: req.url, method: req.method,
            headers: { ...req.headers, host: `127.0.0.1:${up}`, 'content-length': body.length } }, (r) => {
            res.writeHead(r.statusCode, r.headers); r.pipe(res);
        });
        p.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
        p.end(body);
    });
}).listen(Number(listen), '127.0.0.1', () => console.log(`relay ${listen} → ${up}`));
