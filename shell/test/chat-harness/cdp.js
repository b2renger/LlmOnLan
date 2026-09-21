'use strict';
// Minimal Chrome DevTools Protocol client for the chat harness (plan §2.2), following the
// shell/test/e2e.js pattern: Node's global WebSocket, no dependencies, Node >= 22.
//
//   const cdp = await connect({ port: 9333, match: /chat-harness\/page\.html/, timeoutMs: 45000 });
//   await cdp.send('Runtime.evaluate', {...});
//   const off = cdp.on('Runtime.consoleAPICalled', (p) => {...});
//   cdp.close();
//
// `connect` polls http://127.0.0.1:<port>/json until a page target whose url matches shows up,
// opens its websocket and enables Runtime / Page / Log / Storage (Storage needs no enable, it is
// listed for symmetry and ignored).

const http = require('http');

/** GET a JSON document (used for the /json target list). */
function getJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            let b = '';
            res.on('data', (c) => { b += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.setTimeout(4000, () => req.destroy(new Error('timeout')));
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{port:number, match:RegExp, timeoutMs?:number, onClose?:() => void}} opts
 */
async function connect(opts) {
    const { port, match } = opts;
    const timeoutMs = opts.timeoutMs || 45000;
    const deadline = Date.now() + timeoutMs;
    let target = null;
    while (!target && Date.now() < deadline) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json`);
            target = list.find((t) => t.type === 'page' && match.test(String(t.url)));
        } catch { /* electron not listening yet */ }
        if (!target) await sleep(300);
    }
    if (!target) throw new Error(`no CDP page target matching ${match} on port ${port} after ${timeoutMs} ms`);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    /** @type {Map<number, {resolve:Function, reject:Function, method:string}>} */
    const pending = new Map();
    /** @type {Map<string, Set<Function>>} */
    const listeners = new Map();
    let nextId = 0;
    let closed = false;

    ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(String(ev.data)); } catch { return; }
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id);
            pending.delete(m.id);
            if (m.error) p.reject(new Error(`${p.method}: ${JSON.stringify(m.error)}`));
            else p.resolve(m.result);
            return;
        }
        if (m.method) {
            for (const fn of listeners.get(m.method) || []) {
                try { fn(m.params || {}); } catch (e) { console.error('[cdp] listener threw', e); }
            }
            for (const fn of listeners.get('*') || []) {
                try { fn(m.method, m.params || {}); } catch { /* ignore */ }
            }
        }
    };
    ws.onclose = () => {
        closed = true;
        for (const [, p] of pending) p.reject(new Error('CDP socket closed'));
        pending.clear();
        if (opts.onClose) opts.onClose();
    };
    await new Promise((resolve, reject) => {
        ws.onopen = () => resolve(undefined);
        ws.onerror = () => reject(new Error('CDP websocket error'));
    });

    /** @param {string} method @param {object} [params] */
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        if (closed) { reject(new Error('CDP socket closed')); return; }
        const id = ++nextId;
        pending.set(id, { resolve, reject, method });
        ws.send(JSON.stringify({ id, method, params }));
    });

    /** @param {string} event @param {Function} fn @returns {() => void} */
    const on = (event, fn) => {
        const set = listeners.get(event) || new Set();
        set.add(fn);
        listeners.set(event, set);
        return () => set.delete(fn);
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable');

    return {
        target,
        send,
        on,
        get closed() { return closed; },
        close() { try { ws.close(); } catch { /* already gone */ } },
    };
}

module.exports = { connect, getJson, sleep };
