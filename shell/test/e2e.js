// E2E for the no-OWUI shell: drives the REAL app over CDP against test/mock-farm.js.
// Verifies the whole chain a user hits: UDP discovery → overlay clears → model list
// fetched from the farm (the renderer CSP must allow LAN connect) → the farm's
// advertised default preselected → a chat streams to completion above the >150 tok/s
// the stats line rendered.
//
// Flow (from shell/):
//   1. node test/mock-farm.js --coordinator
//   2. LOL_ENDPOINT=http://127.0.0.1:4009/v1 npx electron . --remote-debugging-port=9222
//      (unset ELECTRON_RUN_AS_NODE first — VS Code's integrated shell exports it,
//       which makes `electron` run as plain Node and die on `app.setName`.
//       LOL_ENDPOINT pins the client to the mock: with real farms on the LAN, the
//       client's saved-farm stickiness — by design — beats even a coordinator.)
//   3. node test/e2e.js
//
// No dependencies: Node ≥22 for the global WebSocket.
const http = require('http');

function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let b = '';
            res.on('data', (c) => { b += c; });
            res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

async function main() {
    let target = null;
    for (let i = 0; i < 45 && !target; i++) {
        try {
            const list = await getJson('http://127.0.0.1:9222/json');
            target = list.find((t) => t.type === 'page' && /index\.html/.test(t.url));
        } catch { /* electron not up yet */ }
        if (!target) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!target) throw new Error('no CDP page target after 45s — is electron running with --remote-debugging-port=9222?');
    console.log('[cdp] page:', target.url);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) {
            const p = pending.get(m.id); pending.delete(m.id);
            if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
        }
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const mid = ++id; pending.set(mid, { resolve, reject });
        ws.send(JSON.stringify({ id: mid, method, params }));
    });
    const evalJs = async (expression) => {
        const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails));
        return r.result.value;
    };

    // 1. farm discovered, overlay cleared, model list fetched, default preselected
    let state = null;
    for (let i = 0; i < 30; i++) {
        state = await evalJs(`({
            farm: window.__lolFarm,
            options: [...document.querySelectorAll('#chat-model option')].map(o => o.value || o.text),
            selected: document.getElementById('chat-model').value,
            overlayHidden: document.getElementById('overlay').classList.contains('hidden'),
            pill: document.getElementById('status-text').textContent,
        })`);
        if (state.options.includes('assistant') && state.overlayHidden) break;
        await new Promise((r) => setTimeout(r, 1000));
    }
    console.log('[cdp] state:', JSON.stringify(state));
    if (!state.farm || !/Mock Farm/.test(state.farm.name)) throw new Error('connected to the wrong farm (a real one on the LAN?) — run the mock with --coordinator');
    if (!state.options.includes('assistant')) throw new Error('model list never loaded — CSP/fetch broken?');
    if (state.selected !== 'assistant') throw new Error(`farm default not preselected (got '${state.selected}')`);
    // In the OWUI build the overlay tracks the sidecar, which needs the dev venv
    // (sidecar/.venv) to reach ready — warn rather than fail so this harness still
    // exercises the chat path on a box without it (we drive the DOM via JS, so a
    // visible overlay doesn't block the interaction).
    if (!state.overlayHidden) console.warn('[cdp] WARN: overlay still up (sidecar not ready?) — continuing');

    // OWUI is the primary surface; LOL Chat sits behind the topbar toggle.
    await evalJs(`(() => {
        const b = document.getElementById('view-toggle');
        if (b && document.getElementById('lolchat').classList.contains('hidden')) b.click();
        return document.getElementById('lolchat').classList.contains('hidden') === false;
    })()`).then((visible) => { if (!visible) throw new Error('LOL Chat did not open via the toggle'); });

    // 2. send a message, wait for the streamed reply to finish (stats row appears)
    await evalJs(`(() => {
        document.getElementById('chat-new').click();
        document.getElementById('chat-input').value = 'hello from the harness';
        document.getElementById('chat-form').requestSubmit();
        return true;
    })()`);
    let out = null;
    for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        out = await evalJs(`(() => {
            const rows = [...document.querySelectorAll('.chat-msg.assistant')];
            const last = rows[rows.length - 1];
            if (!last) return null;
            const stats = last.querySelector('.chat-stats');
            return {
                done: !!stats,
                stats: stats ? stats.textContent : null,
                reasoning: !!last.querySelector('details.chat-reasoning'),
                textLen: last.textContent.length,
            };
        })()`);
        if (out && out.done) break;
    }
    console.log('[cdp] reply:', JSON.stringify(out));
    if (!out || !out.done) throw new Error('reply never finished (no stats row)');
    if (!/tok\/s/.test(out.stats)) throw new Error('stats line malformed: ' + out.stats);
    if (!out.reasoning) throw new Error('reasoning_content deltas not rendered');
    const toks = parseFloat(out.stats.split('·')[1]);
    if (!(toks > 150)) throw new Error(`render path too slow: ${out.stats} — the mock streams ~330/s`);
    console.log('E2E OK —', out.stats);
    ws.close();
    process.exit(0);
}

main().catch((e) => { console.error('E2E FAIL:', e.message); process.exit(1); });
