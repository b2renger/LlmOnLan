// The Computer as an MCP server (owner, 2026-09-27; docs/ECOSYSTEM_PLAN.md §8c): Open WebUI — or an app
// built in LOL Vibe — lists, builds and runs graphs through the Model Context Protocol.
//
//   - Streamable HTTP, JSON responses only (no server-sent stream: every tool answers once), on
//     127.0.0.1 ONLY, behind a per-install bearer token. JSON-RPC 2.0: initialize, tools/list, tools/call,
//     ping; notifications are accepted with 202.
//   - The tools run in the page (renderer/chat/computer/mcp-tools.mjs) through the Computer's own doors;
//     main only carries the call across and waits for the answer.
//   - Never the outputs: a tool can never arm them, and a run is refused while a person has them armed
//     (the page enforces it; outputs.ts is the source of truth).
//   - Open WebUI finds it through its public TOOL_SERVER_CONNECTIONS env (configBridge.ts), no OWUI change.
//   - The same listener answers Open WebUI's web search (POST /web/search, webSearch.ts) through OWUI's public
//     external-search env — same Host check, same bearer.

import * as http from 'http';
import * as crypto from 'crypto';

export const MCP_PORT = 41995;
export const MCP_PATH = '/mcp';
export const WEB_SEARCH_PATH = '/web/search';
const PROTOCOL = '2025-06-18';
const MAX_BODY = 1024 * 1024;
const MAX_SEARCH_BODY = 64 * 1024;        // {query, count}
const CALL_TIMEOUT_MS = 10 * 60 * 1000;   // a run may take minutes (the run's own wall-clock cap is 10 min)

export interface McpTool { name: string; description: string; inputSchema: Record<string, unknown> }
export interface McpDeps {
    token: string;
    version: string;
    tools: () => McpTool[];
    /** Run one tool in the page. Resolves the tool's text result, or rejects with a sentence. */
    call: (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
    /** Web search v2 for Open WebUI: [{link, title, snippet}], or rejects with a sentence. None: no /web/search. */
    webSearch?: (query: string, count: number) => Promise<object[]>;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** PURE apart from `deps`: one JSON-RPC message → its answer (null for a notification). */
export async function handleRpc(msg: Rpc, deps: McpDeps): Promise<object | null> {
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return fail(msg && msg.id, -32600, 'not a JSON-RPC request');
    const isNotification = msg.id === undefined || msg.id === null;
    switch (msg.method) {
        case 'initialize':
            return reply(msg.id, {
                protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL,
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'llmonlan-computer', title: 'LlmOnLan Computer', version: deps.version },
                instructions: 'Build and run graphs on the LlmOnLan Computer. list_box_types says what each box does; read_graph shows the open graph. When a home is linked, home_devices, home_state and home_command reach its Home Assistant.',
            });
        case 'ping':
            return reply(msg.id, {});
        case 'tools/list':
            return reply(msg.id, { tools: deps.tools() });
        case 'tools/call': {
            const name = String(msg.params?.name || '');
            if (!deps.tools().some((t) => t.name === name)) return fail(msg.id, -32602, `no tool named ${name}`);
            const args = msg.params?.arguments && typeof msg.params.arguments === 'object' ? msg.params.arguments : {};
            try {
                const out = await deps.call(name, args);
                return reply(msg.id, { content: [{ type: 'text', text: out.text }], isError: !!out.isError });
            } catch (e) {
                return reply(msg.id, { content: [{ type: 'text', text: String((e as Error)?.message || e) }], isError: true });
            }
        }
        default:
            if (isNotification) return null;   // notifications/initialized and friends: nothing to say
            return fail(msg.id, -32601, `unknown method ${msg.method}`);
    }
}

function tokenOk(header: string | undefined, token: string): boolean {
    const m = /^Bearer\s+(.+)$/i.exec(String(header || ''));
    if (!m || !token) return false;
    const a = Buffer.from(m[1]);
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** The HTTP listener, loopback only. Resolves the server, or null when the port is taken. */
export function startMcpServer(deps: McpDeps, port = MCP_PORT): Promise<http.Server | null> {
    const server = http.createServer((req, res) => {
        const send = (status: number, body?: object | null, extra: Record<string, string> = {}) => {
            res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
            res.end(body ? JSON.stringify(body) : '');
        };
        const path = (req.url || '').split('?')[0];
        const search = path === WEB_SEARCH_PATH && !!deps.webSearch;
        if (path !== MCP_PATH && !search) return send(404, { error: 'not found' });
        // Defence in depth behind the bearer (critic N5; the MCP spec asks servers to check where a request came
        // from): only a request addressed to THIS loopback server — a rebound DNS name carries another Host.
        const bound = (server.address() as { port?: number } | null)?.port;
        const host = String(req.headers.host || '').toLowerCase();
        if (host !== `127.0.0.1:${bound}` && host !== `localhost:${bound}`) return send(403, { error: 'wrong host' });
        if (!tokenOk(req.headers.authorization, deps.token)) return send(401, { error: 'unauthorized' });
        if (req.method === 'GET' && !search) return send(405, { error: 'no server-sent stream: every answer comes in the POST' }, { allow: 'POST' });
        if (req.method === 'DELETE' && !search) return send(200, {});
        if (req.method !== 'POST') return send(405, { error: 'POST only' }, { allow: 'POST' });
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => {
            size += c.length;
            // `connection: close`: a client's keep-alive pool must not reuse the socket cut here.
            if (size > (search ? MAX_SEARCH_BODY : MAX_BODY)) { send(413, { error: 'too big' }, { connection: 'close' }); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', async () => {
            if (res.writableEnded) return;
            if (search) {
                // Open WebUI's external-search contract (retrieval/web/external.py, 0.10.x and 0.11.4 alike):
                // {query, count} → [{link, title, snippet}]. An error status reads as "no results" there.
                let body: { query?: unknown; count?: unknown };
                try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) || {}; } catch { return send(400, { error: 'not JSON' }); }
                const query = String(body.query ?? '').slice(0, 400).trim();
                if (!query) return send(400, { error: 'no query' });
                const count = Math.max(1, Math.min(10, Math.floor(Number(body.count)) || 5));
                try { return send(200, await deps.webSearch!(query, count)); } catch (e) {
                    console.warn(`[web] search failed: ${String((e as Error)?.message || e)}`);   // never the question
                    return send(502, { error: String((e as Error)?.message || e) });
                }
            }
            let msg: Rpc | Rpc[];
            try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, fail(null, -32700, 'not JSON')); }
            const batch = Array.isArray(msg) ? msg : [msg];
            const answers = (await Promise.all(batch.map((m) => handleRpc(m, deps)))).filter((a) => a !== null);
            if (!answers.length) return send(202, null);
            send(200, Array.isArray(msg) ? answers : answers[0]);
        });
    });
    return new Promise((resolve) => {
        server.once('error', () => resolve(null));
        server.listen(port, '127.0.0.1', () => resolve(server));
    });
}

/** Carry a tool call to the page and wait for its answer. `sendToPage` posts {id, name, args}. */
export function pageCaller(sendToPage: (msg: { id: string; name: string; args: Record<string, unknown> }) => void) {
    const waiting = new Map<string, (out: { text: string; isError?: boolean }) => void>();
    return {
        call(name: string, args: Record<string, unknown>): Promise<{ text: string; isError?: boolean }> {
            const id = crypto.randomUUID();
            return new Promise((resolve) => {
                const timer = setTimeout(() => { waiting.delete(id); resolve({ text: 'The Computer did not answer in time.', isError: true }); }, CALL_TIMEOUT_MS);
                waiting.set(id, (out) => { clearTimeout(timer); resolve(out); });
                try { sendToPage({ id, name, args }); } catch { waiting.delete(id); clearTimeout(timer); resolve({ text: 'The Computer is not open.', isError: true }); }
            });
        },
        answered(id: string, out: { text: string; isError?: boolean }): void {
            const fn = waiting.get(id);
            waiting.delete(id);
            if (fn) fn({ text: String(out && out.text || ''), isError: !!(out && out.isError) });
        },
    };
}

/** The tools, described for a model (P4's lesson: clear, non-overlapping names and descriptions). */
export const TOOLS: McpTool[] = [
    { name: 'list_graphs', description: 'List the graphs in the Computer\'s library: id, title and number of boxes.', inputSchema: { type: 'object', properties: {} } },
    { name: 'open_graph', description: 'Open one graph of the library on the Computer\'s canvas, by its id.', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'new_graph', description: 'Create a new, empty graph with this title and open it.', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
    { name: 'read_graph', description: 'Describe the OPEN graph: every box (id, type, settings, state, value) and every arrow (from, to, port, label).', inputSchema: { type: 'object', properties: {} } },
    { name: 'list_box_types', description: 'The kinds of box you can add: for each, what it does, its inputs and its output.', inputSchema: { type: 'object', properties: {} } },
    { name: 'add_box', description: 'Add a box to the open graph. type is one of list_box_types (e.g. note, ask, code, preview). settings are optional (e.g. {"text": "…"} for a note, {"instruction": "…"} for ask). Returns the new box id.', inputSchema: { type: 'object', properties: { type: { type: 'string' }, settings: { type: 'object' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['type'] } },
    { name: 'connect_boxes', description: 'Draw an arrow from the output of one box to an input port of another. port defaults to the target\'s first input; label names the arrow (an Instruction then reads it as {label}).', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, port: { type: 'string' }, label: { type: 'string' } }, required: ['from', 'to'] } },
    { name: 'set_box', description: 'Change settings of one box of the open graph, by its id.', inputSchema: { type: 'object', properties: { id: { type: 'string' }, settings: { type: 'object' } }, required: ['id', 'settings'] } },
    { name: 'run_graph', description: 'Run the open graph (or only from one box, with from) and wait until it finishes. Returns each box\'s state and value. Outputs to devices stay a dry run.', inputSchema: { type: 'object', properties: { from: { type: 'string' } } } },
];
