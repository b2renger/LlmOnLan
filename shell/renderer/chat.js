// LOL Chat — a lightweight Unsloth-Studio-style chat surface, as an ALTERNATIVE
// view to the embedded Open WebUI.
//
// ---------------------------------------------------------------------------
// SCOPE, deliberately narrow. CLAUDE.md makes Open WebUI vendored+unmodified a
// prime directive and puts "reimplementing chat, RAG, or model management" out of
// scope, because everything rebuilt here is something OWUI already does better.
// This exists to A/B a Studio-like UX with real users, NOT to replace OWUI:
//   • it talks straight to the farm's OpenAI endpoint, never to the sidecar;
//   • it has NO RAG, no knowledge bases, no document upload, no tools, no auth;
//   • conversations live in localStorage on this machine only.
// If the answer to the A/B is "users prefer OWUI", this whole file is deleted.
// ---------------------------------------------------------------------------

(() => {
    const $ = (id) => document.getElementById(id);
    const STORE_KEY = 'lol.chat.threads.v1';

    const el = {
        root: $('lolchat'),
        list: $('chat-threads'),
        msgs: $('chat-messages'),
        form: $('chat-form'),
        input: $('chat-input'),
        send: $('chat-send'),
        stop: $('chat-stop'),
        model: $('chat-model'),
        newBtn: $('chat-new'),
        empty: $('chat-empty'),
    };
    if (!el.root) return;

    // The farm endpoint app.js is currently pointing the sidecar at. Published on
    // window rather than re-derived here so there is exactly one source of truth.
    const endpoint = () => (window.__lolFarm && window.__lolFarm.openaiBaseUrl) || null;

    let threads = load();
    let activeId = threads[0] ? threads[0].id : null;
    let abort = null;

    function load() {
        try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
    }
    function save() {
        // Storage can throw (private mode, quota). Losing history is survivable;
        // breaking the UI is not.
        try { localStorage.setItem(STORE_KEY, JSON.stringify(threads.slice(0, 100))); } catch { /* ignore */ }
    }
    const active = () => threads.find((t) => t.id === activeId) || null;

    function newThread() {
        const t = { id: String(Date.now()) + Math.random().toString(36).slice(2, 7), title: 'New chat', messages: [] };
        threads.unshift(t);
        activeId = t.id;
        save(); renderThreads(); renderMessages(); el.input.focus();
    }

    function renderThreads() {
        el.list.innerHTML = '';
        for (const t of threads) {
            const b = document.createElement('button');
            b.className = 'chat-thread' + (t.id === activeId ? ' active' : '');
            b.textContent = t.title;
            b.title = t.title;
            b.onclick = () => { activeId = t.id; renderThreads(); renderMessages(); };
            const x = document.createElement('span');
            x.className = 'chat-thread-x';
            x.textContent = '×';
            x.title = 'Delete';
            x.onclick = (e) => {
                e.stopPropagation();
                threads = threads.filter((v) => v.id !== t.id);
                if (activeId === t.id) activeId = threads[0] ? threads[0].id : null;
                save(); renderThreads(); renderMessages();
            };
            b.appendChild(x);
            el.list.appendChild(b);
        }
    }

    // Minimal, escaped rendering: fenced code blocks become <pre>, everything else is
    // plain text. No HTML from the model is ever inserted — this surface has no
    // sanitizer and does not need one if nothing is parsed as markup.
    function renderBody(text) {
        const frag = document.createDocumentFragment();
        const parts = String(text).split(/```/);
        parts.forEach((chunk, i) => {
            if (i % 2 === 1) {
                const pre = document.createElement('pre');
                pre.className = 'chat-code';
                pre.textContent = chunk.replace(/^[a-zA-Z0-9_+-]*\n/, '');
                frag.appendChild(pre);
            } else if (chunk) {
                const p = document.createElement('div');
                p.className = 'chat-text';
                p.textContent = chunk;
                frag.appendChild(p);
            }
        });
        return frag;
    }

    function renderMessages() {
        const t = active();
        el.msgs.innerHTML = '';
        el.empty.classList.toggle('hidden', !!(t && t.messages.length));
        if (!t) return;
        for (const m of t.messages) {
            const row = document.createElement('div');
            row.className = 'chat-msg ' + m.role;
            if (m.reasoning) {
                const d = document.createElement('details');
                d.className = 'chat-reasoning';
                const s = document.createElement('summary');
                s.textContent = 'reasoning';
                d.appendChild(s);
                d.appendChild(renderBody(m.reasoning));
                row.appendChild(d);
            }
            row.appendChild(renderBody(m.content || ''));
            if (m.stats) {
                const f = document.createElement('div');
                f.className = 'chat-stats';
                f.textContent = m.stats;
                row.appendChild(f);
            }
            el.msgs.appendChild(row);
        }
        el.msgs.scrollTop = el.msgs.scrollHeight;
    }

    // The endpoint the current <select> options were fetched from. publishFarm()
    // re-runs every few seconds; refetching only when the farm changed (or the last
    // fetch failed) means a failed farm self-heals on the next tick while a user's
    // explicit model choice is never reset mid-session.
    let modelsFrom = null;

    async function refreshModels() {
        const base = endpoint();
        if (!base) {
            modelsFrom = null;
            el.model.replaceChildren(new Option('no farm', ''));
            return;
        }
        if (base === modelsFrom && el.model.value) return;
        try {
            const r = await fetch(base + '/models');
            const j = await r.json();
            const ids = (j.data || []).map((m) => m.id);
            if (!ids.length) {
                modelsFrom = null;
                el.model.replaceChildren(new Option('no models', ''));
                return;
            }
            const prev = el.model.value;
            el.model.replaceChildren(...ids.map((id) => new Option(id, id)));
            // Keep the user's pick if still served; else the farm's advertised
            // default (the model the farm actually wants clients on); else first.
            const def = (window.__lolFarm && window.__lolFarm.defaultModel) || null;
            el.model.value = ids.includes(prev) ? prev : (ids.includes(def) ? def : ids[0]);
            modelsFrom = base;
        } catch {
            modelsFrom = null; // retry on the next publishFarm tick
            el.model.replaceChildren(new Option('unreachable', ''));
        }
    }

    function setBusy(on) {
        el.send.classList.toggle('hidden', on);
        el.stop.classList.toggle('hidden', !on);
        el.input.disabled = on;
    }

    async function send(text) {
        const base = endpoint();
        if (!base) return;
        let t = active();
        if (!t) { newThread(); t = active(); }
        t.messages.push({ role: 'user', content: text });
        if (t.title === 'New chat') t.title = text.slice(0, 40);
        const assistant = { role: 'assistant', content: '', reasoning: '' };
        t.messages.push(assistant);
        save(); renderThreads(); renderMessages();

        abort = new AbortController();
        setBusy(true);
        const t0 = performance.now();
        let ttft = null, tokens = 0, deltas = 0;

        // Incremental streaming render. The full renderMessages() is O(whole thread)
        // and calling it per token stalls the renderer at 100+ tok/s — the read loop
        // shares the main thread, so the DOM work throttles the stream itself and
        // the UI feels far slower than the farm is. Instead: render the thread once
        // (renderMessages above), then update ONLY the last row's bodies, at most
        // once per animation frame.
        const live = { row: el.msgs.lastElementChild, details: null, reasoningBody: null, contentBody: null, raf: 0 };
        const paint = () => {
            live.raf = 0;
            if (!live.row || !live.row.isConnected) return;
            // Only follow the stream when the user is already at the bottom —
            // never yank the view away from someone reading scrollback.
            const pinned = el.msgs.scrollHeight - el.msgs.scrollTop - el.msgs.clientHeight < 48;
            if (assistant.reasoning) {
                if (!live.details) {
                    live.details = document.createElement('details');
                    live.details.className = 'chat-reasoning';
                    const s = document.createElement('summary');
                    s.textContent = 'reasoning';
                    live.details.appendChild(s);
                    live.reasoningBody = document.createElement('div');
                    live.details.appendChild(live.reasoningBody);
                    live.row.prepend(live.details);
                }
                live.reasoningBody.replaceChildren(renderBody(assistant.reasoning));
            }
            if (!live.contentBody) {
                live.contentBody = document.createElement('div');
                live.row.appendChild(live.contentBody);
            }
            live.contentBody.replaceChildren(renderBody(assistant.content || ''));
            if (pinned) el.msgs.scrollTop = el.msgs.scrollHeight;
        };
        const schedule = () => { if (!live.raf) live.raf = requestAnimationFrame(paint); };

        try {
            const res = await fetch(base + '/chat/completions', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                signal: abort.signal,
                body: JSON.stringify({
                    model: el.model.value,
                    // Only the real turns; never the placeholder we just pushed.
                    messages: t.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
                    stream: true,
                    stream_options: { include_usage: true },
                }),
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const rd = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            for (;;) {
                const { done, value } = await rd.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                let nl;
                while ((nl = buf.indexOf('\n')) >= 0) {
                    const line = buf.slice(0, nl).trim();
                    buf = buf.slice(nl + 1);
                    if (!line.startsWith('data:')) continue;
                    const data = line.slice(5).trim();
                    if (data === '[DONE]') continue;
                    let o; try { o = JSON.parse(data); } catch { continue; }
                    if (o.usage && o.usage.completion_tokens != null) tokens = o.usage.completion_tokens;
                    const d = o.choices && o.choices[0] && o.choices[0].delta;
                    if (!d) continue;
                    // Ollama streams `reasoning`; llama.cpp streams `reasoning_content`.
                    const r = d.reasoning || d.reasoning_content || '';
                    if (d.content) assistant.content += d.content;
                    if (r) assistant.reasoning += r;
                    if (d.content || r) {
                        deltas += 1;
                        if (ttft === null) ttft = performance.now() - t0;
                        schedule();
                    }
                }
            }
            const total = (performance.now() - t0) / 1000;
            const gen = Math.max(0.001, total - (ttft || 0) / 1000);
            // No usage in the stream (proxy/backend dependent) → ~1 token per delta.
            if (!tokens) tokens = deltas;
            if (tokens) assistant.stats = `${tokens} tok · ${(tokens / gen).toFixed(1)} tok/s · first token ${((ttft || 0) / 1000).toFixed(2)}s`;
        } catch (e) {
            if (e.name !== 'AbortError') assistant.content += `\n\n[error: ${e.message}]`;
        } finally {
            if (live.raf) cancelAnimationFrame(live.raf);
            if (!assistant.reasoning) delete assistant.reasoning;
            abort = null;
            setBusy(false);
            save(); renderMessages(); el.input.focus();
        }
    }

    el.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = el.input.value.trim();
        if (!v) return;
        el.input.value = '';
        el.input.style.height = 'auto';
        send(v);
    });
    // Enter sends, Shift+Enter newlines — the convention every chat UI uses.
    el.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.form.requestSubmit(); }
    });
    el.input.addEventListener('input', () => {
        el.input.style.height = 'auto';
        el.input.style.height = Math.min(el.input.scrollHeight, 200) + 'px';
    });
    el.stop.addEventListener('click', () => { if (abort) abort.abort(); });
    el.newBtn.addEventListener('click', newThread);

    // app.js calls this when the view is shown or the farm changes — and every few
    // seconds from its publishFarm interval. While a reply is streaming, the live
    // row owns the DOM: a full re-render here would orphan the node the stream is
    // painting into, so skip it (the finally{} above re-renders when the stream
    // ends). refreshModels is safe either way — it no-ops unless the farm changed.
    window.__lolChatRefresh = () => {
        refreshModels();
        if (!abort) { renderThreads(); renderMessages(); }
    };

    renderThreads();
    renderMessages();
})();
