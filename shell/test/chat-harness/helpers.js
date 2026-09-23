'use strict';
// The `h` API every harness scenario is written against (plan §2.2). One instance per RUN (not per
// scenario): `h.fresh()` is what resets the world between scenarios.
//
// Everything that talks to the page goes through CDP `Runtime.evaluate` with `returnByValue`, so a
// scenario can only observe what the real DOM/JS exposes — no privileged back door into the chat's
// internals beyond `window.LolChat`, which production also exposes.

const fs = require('fs');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// U+2028 / U+2029 are valid in a JSON string but terminate a JS line — they must be escaped
// before the payload is spliced into a Runtime.evaluate expression.
const LINE_SEPS = new RegExp('[\\u2028\\u2029]', 'g');

/** JSON.stringify that survives being embedded in a JS expression. */
function jsArgs(args) {
    return JSON.stringify(args === undefined ? [] : args)
        .replace(LINE_SEPS, (c) => '\\u' + c.charCodeAt(0).toString(16));
}

/** Minimal Node-side HTTP (the mock's control plane; the page never sees these). */
function req(method, url, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const payload = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
        const r = http.request({
            method,
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            headers: payload ? { 'content-type': 'application/json', 'content-length': payload.length } : {},
        }, (res) => {
            let b = '';
            res.on('data', (c) => { b += c; });
            res.on('end', () => {
                let parsed = b;
                try { parsed = JSON.parse(b); } catch { /* text body */ }
                resolve({ status: res.statusCode, body: parsed, text: b });
            });
        });
        r.on('error', reject);
        r.setTimeout(10000, () => r.destroy(new Error('timeout ' + method + ' ' + url)));
        if (payload) r.write(payload);
        r.end();
    });
}

/**
 * @param {{
 *   cdp: any, ports: {cdp:number, proxy:number, keyed:number, services:number, self:number},
 *   tmpDir: string, harnessDir: string, strict: boolean, show?: boolean, hasMock: boolean,
 *   consoleErrors: string[], notes: string[], shotsDir: string,
 * }} ctx
 */
function createHelpers(ctx) {
    const { cdp, ports, tmpDir, harnessDir } = ctx;
    const PAGE_URL = pathToFileURL(path.join(harnessDir, 'page.html')).href;
    const services = 'http://127.0.0.1:' + ports.services;
    let lastReloadOpts = { farm: 'mock', flags: {}, refreshMs: 4000 };
    // Set once the first Page.captureScreenshot TIMES OUT: a hidden window never produces a frame,
    // so every later call in this run answers immediately instead of burning another 6 s. A CDP
    // error is NOT latched here — that used to turn one transient failure under --show into a run
    // where every h.screenshot() silently returned null and no scenario noticed.
    let noScreenshots = false;

    /** Evaluate `fn` in the page with JSON-serialisable args; returns its (awaited) value. */
    async function evalFn(fn, ...args) {
        const expression = '(' + fn.toString() + ').apply(null, ' + jsArgs(args) + ')';
        const r = await cdp.send('Runtime.evaluate', {
            expression, returnByValue: true, awaitPromise: true, userGesture: true,
        });
        if (r.exceptionDetails) {
            const d = r.exceptionDetails;
            const msg = (d.exception && (d.exception.description || d.exception.value)) || d.text;
            throw new Error('page exception: ' + msg);
        }
        return r.result ? r.result.value : undefined;
    }

    async function waitFor(fn, opts = {}) {
        const timeout = opts.timeout || 15000;
        const interval = opts.interval || 100;
        const args = opts.args || [];
        const deadline = Date.now() + timeout;
        let last;
        for (;;) {
            try {
                last = await evalFn(fn, ...args);
                if (last) return last;
            } catch (e) {
                last = '(threw) ' + e.message;
            }
            if (Date.now() >= deadline) {
                throw new Error('waitFor timed out after ' + timeout + ' ms; last value: ' + JSON.stringify(last));
            }
            await sleep(interval);
        }
    }

    function pageUrl(opts = {}) {
        const o = Object.assign({ farm: 'mock', flags: {}, refreshMs: 4000 }, opts);
        const flags = Object.assign({}, o.flags);
        // --strict turns the fakes off, unless the scenario asked for them explicitly (h0-loader
        // tests the LOADER, and must exercise the same path in both modes).
        if (ctx.strict && flags.allowFakes === undefined) flags.allowFakes = false;
        const q = new URLSearchParams();
        q.set('farm', o.farm);
        q.set('refreshMs', String(o.refreshMs));
        q.set('proxy', String(ports.proxy));
        q.set('keyed', String(ports.keyed));
        q.set('self', String(ports.self));
        q.set('key', 'harness-pw');
        if (Object.keys(flags).length) q.set('flags', JSON.stringify(flags));
        return { url: PAGE_URL + '?' + q.toString(), opts: o };
    }

    async function navigate(url) {
        await cdp.send('Page.navigate', { url });
        // Runtime.evaluate can still land in the OLD context for a beat after navigate; poll on the
        // location as well as the state so we never read the previous document's globals.
        const want = url.split('?')[1] || '';
        const blankTarget = url === 'about:blank';
        const deadline = Date.now() + 30000;
        for (;;) {
            try {
                const state = await evalFn(() => ({
                    here: location.search.slice(1),
                    ready: !!(window.LolChat && window.LolChat.ready),
                    blank: location.href === 'about:blank',
                    doc: document.readyState,
                }));
                if (blankTarget ? state.blank : (state.here === want && state.ready)) return state;
            } catch (e) { /* context swapped under us */ }
            if (Date.now() > deadline) throw new Error('navigate: page never became ready: ' + url);
            await sleep(80);
        }
    }

    async function reload(opts = {}) {
        const built = pageUrl(Object.assign({}, lastReloadOpts, opts));
        lastReloadOpts = built.opts;
        ctx.consoleErrors.length = 0;
        await navigate(built.url);
        return built.opts;
    }

    async function fresh(opts = {}) {
        await cdp.send('Page.navigate', { url: 'about:blank' });
        await sleep(60);
        try {
            await cdp.send('Storage.clearDataForOrigin', { origin: 'file://', storageTypes: 'all' });
        } catch (e) {
            ctx.notes.push('clearDataForOrigin failed: ' + e.message);
        }
        if (ctx.hasMock) {
            try { await req('POST', services + '/mock/reset', {}); } catch (e) { /* mock optional */ }
        }
        return reload(Object.assign({ farm: 'mock', flags: {}, refreshMs: 4000 }, opts));
    }

    // ---- input -------------------------------------------------------------------------------

    const click = (sel) => evalFn((s) => {
        const el = document.querySelector(s);
        if (!el) throw new Error('click: no element for ' + s);
        el.click();
        return true;
    }, sel);

    const type = (sel, text) => evalFn((s, v) => {
        const el = document.querySelector(s);
        if (!el) throw new Error('type: no element for ' + s);
        el.focus();
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) setter.set.call(el, v); else el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return el.value;
    }, sel, text);

    /** A real KeyboardEvent, including the IME properties the constructor may ignore. */
    const key = (sel, k, opts = {}) => evalFn((s, kk, o) => {
        const el = s ? document.querySelector(s) : document.activeElement;
        if (!el) throw new Error('key: no element for ' + s);
        const init = {
            key: kk, code: kk.length === 1 ? 'Key' + kk.toUpperCase() : kk,
            bubbles: true, cancelable: true, composed: true,
            ctrlKey: !!o.ctrl, shiftKey: !!o.shift, altKey: !!o.alt, metaKey: !!o.meta,
            isComposing: !!o.isComposing, keyCode: o.keyCode || 0, which: o.keyCode || 0,
        };
        const make = (t) => {
            const ev = new KeyboardEvent(t, init);
            if (o.isComposing && ev.isComposing !== true) Object.defineProperty(ev, 'isComposing', { get: () => true });
            if (o.keyCode && ev.keyCode !== o.keyCode) {
                Object.defineProperty(ev, 'keyCode', { get: () => o.keyCode });
                Object.defineProperty(ev, 'which', { get: () => o.keyCode });
            }
            return ev;
        };
        if (el.focus) el.focus();
        const down = make('keydown');
        const notCancelled = el.dispatchEvent(down);
        const seen = { isComposing: down.isComposing, keyCode: down.keyCode, defaultPrevented: down.defaultPrevented };
        if (o.up !== false) el.dispatchEvent(make('keyup'));
        return Object.assign({ dispatched: true, notCancelled }, seen);
    }, sel, k, opts);

    /** The e2e.js pattern: new chat, fill, submit — in ONE evaluate so nothing races the composer. */
    const submit = (text) => evalFn((v) => {
        const nb = document.getElementById('chat-new');
        if (nb) nb.click();
        const input = document.getElementById('chat-input');
        const form = document.getElementById('chat-form');
        if (!input || !form) throw new Error('submit: composer not in the DOM');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(input, v); else input.value = v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        form.requestSubmit();
        return true;
    }, text);

    const waitReply = (opts = {}) => waitFor(() => {
        const msgs = Array.prototype.slice.call(document.querySelectorAll('.chat-msg.assistant'));
        const last = msgs[msgs.length - 1];
        if (!last) return null;
        const stats = last.querySelector('.chat-stats');
        if (!stats || !stats.textContent.trim()) return null;
        const body = last.querySelector('.chat-body');
        const reasoning = last.querySelector('.chat-reasoning');
        return {
            stats: stats.textContent.trim(),
            text: body ? body.textContent : last.textContent,
            reasoning: reasoning ? reasoning.textContent : null,
            id: last.getAttribute('data-id'),
            status: last.getAttribute('data-status'),
        };
    }, { timeout: opts.timeout || 30000 });

    /** files: [{name, mime, base64}] to a real DataTransfer of File objects. */
    const transfer = (kind) => (sel, files) => evalFn((s, fs2, k2) => {
        const el = document.querySelector(s);
        if (!el) throw new Error(k2 + ': no element for ' + s);
        const dt = new DataTransfer();
        for (const f of fs2) {
            const bin = atob(f.base64 || '');
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            dt.items.add(new File([bytes], f.name, { type: f.mime || 'application/octet-stream' }));
        }
        if (k2 === 'drop') el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        const ev = k2 === 'drop'
            ? new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
            : new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        const notCancelled = el.dispatchEvent(ev);
        return { files: dt.files.length, notCancelled, defaultPrevented: ev.defaultPrevented };
    }, sel, files, kind);

    // ---- spies -------------------------------------------------------------------------------

    async function installClipboardSpy() {
        await evalFn(() => {
            window.__spyClipboard = [];
            const nav = navigator;
            if (!nav.clipboard) Object.defineProperty(nav, 'clipboard', { configurable: true, value: {} });
            nav.clipboard.writeText = (s) => { window.__spyClipboard.push(String(s)); return Promise.resolve(); };
            const oldExec = document.execCommand ? document.execCommand.bind(document) : null;
            document.execCommand = function (cmd) {
                if (String(cmd).toLowerCase() === 'copy') {
                    window.__spyClipboard.push(String(window.getSelection() || ''));
                    return true;
                }
                return oldExec ? oldExec.apply(null, arguments) : false;
            };
            return true;
        });
        const reader = () => evalFn(() => window.__spyClipboard || []);
        reader.clear = () => evalFn(() => { window.__spyClipboard = []; return true; });
        return reader;
    }

    async function installNotificationSpy() {
        await evalFn(() => {
            window.__spyNotifications = [];
            class FakeNotification {
                constructor(title, options) {
                    this.title = title;
                    this.options = options || {};
                    window.__spyNotifications.push({ title: String(title), options: JSON.parse(JSON.stringify(options || {})), ts: Date.now() });
                }
                close() { this.closed = true; }
                addEventListener() { }
            }
            FakeNotification.permission = 'granted';
            FakeNotification.requestPermission = () => Promise.resolve('granted');
            Object.defineProperty(window, 'Notification', { configurable: true, writable: true, value: FakeNotification });
            return true;
        });
        const reader = () => evalFn(() => window.__spyNotifications || []);
        reader.clear = () => evalFn(() => { window.__spyNotifications = []; return true; });
        return reader;
    }

    // ---- files written by the main process ---------------------------------------------------

    function readJsonFile(file, dflt) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return dflt; }
    }

    /** The three main-process logs (downloads / shell calls / window opens) are ONE array per
     *  electron process, appended to for the whole run — so `h.downloads()[0]` used to be the
     *  first download of the RUN, not of the scenario (measured at the C3 landing: p2-export-import
     *  read c3-canvas's earlier .lolgraph.json and reported "the file says which format it is: got
     *  undefined"). `markLogs()` records where each log stood when the scenario began and the
     *  readers slice from there, so every scenario sees only what it caused. run.js calls it once
     *  per scenario, before `fresh()`. */
    const logFiles = {
        downloads: path.join(tmpDir, 'downloads.json'),
        shellCalls: path.join(tmpDir, 'shell-calls.json'),
        windowOpens: path.join(tmpDir, 'window-opens.json'),
    };
    const logMarks = { downloads: 0, shellCalls: 0, windowOpens: 0 };
    function markLogs() {
        for (const key of Object.keys(logFiles)) logMarks[key] = readJsonFile(logFiles[key], []).length;
    }
    const readLog = (key) => readJsonFile(logFiles[key], []).slice(logMarks[key]);

    // ---- the API -----------------------------------------------------------------------------

    const h = {
        ports,
        tmpDir,
        strict: ctx.strict,
        // true when run.js was started with --show, i.e. the window can actually produce frames and
        // a scenario is entitled to DEMAND a screenshot rather than shrug at a null.
        show: !!ctx.show,
        eval: evalFn,
        waitFor,
        reload,
        fresh,
        click,
        type,
        key,
        submit,
        waitReply,
        drop: transfer('drop'),
        paste: transfer('paste'),

        mock: {
            available: ctx.hasMock,
            // The mock filters server-side on since/path/model/role and answers a bare JSON array.
            async log(opts = {}) {
                const q = new URLSearchParams();
                q.set('since', String(opts.since || 0));
                if (opts.path) q.set('path', opts.path);
                if (opts.model) q.set('model', opts.model);
                if (opts.role) q.set('role', opts.role);
                const r = await req('GET', services + '/mock/log?' + q.toString());
                return Array.isArray(r.body) ? r.body : (r.body && r.body.log) || [];
            },
            async warnings() { return (await req('GET', services + '/mock/warnings')).body; },
            async reset() { return (await req('POST', services + '/mock/reset', {})).body; },
            async state(patch) { return (await req('POST', services + '/mock/state', patch || {})).body; },
            async lastBody() { return (await req('GET', services + '/mock/last-body')).body; },
            async health() { return (await req('GET', services + '/mock/health')).body; },
            async self() { return (await req('GET', 'http://127.0.0.1:' + ports.self + '/lol/self')).body; },
        },

        blender: {
            set(conn) {
                const file = path.join(tmpDir, 'blender.json');
                if (conn === null || conn === undefined) {
                    try { fs.unlinkSync(file); } catch (e) { /* already absent */ }
                    return null;
                }
                fs.writeFileSync(file, JSON.stringify(conn, null, 2));
                return conn;
            },
        },

        spy: {
            clipboard: installClipboardSpy,
            notifications: installNotificationSpy,
        },

        // ---- Studio rails (S0 kickoff, studio plan 2.2) ---------------------------------------
        // The DOM contract these drive is frozen in LOLCHAT_PLAN.md 2.6 BD: the rail is
        // `.chat-work-rail [role=tab][data-panel=<id>]`, the width control is
        // `.chat-work-head [role=radio][data-width=chat|split|work]`, and `.chat-work` carries
        // `data-width` with the resolved state. h.work/h.width go through the real widgets.

        /** Open a panel through the tab rail (null closes the workbench). → {panel, width} */
        async work(panelId) {
            await evalFn((id) => {
                const rail = document.querySelector('.chat-work-rail');
                if (!rail) throw new Error('no .chat-work-rail: ui/workbench.mjs has not landed');
                if (id === null || id === undefined) {
                    const open = rail.querySelector('[role="tab"][aria-selected="true"]');
                    if (open) open.click();                       // clicking the live tab closes it
                    return true;
                }
                const tab = rail.querySelector(`[role="tab"][data-panel="${id}"]`);
                if (!tab) throw new Error(`no tab for panel "${id}" in the rail`);
                tab.click();
                return true;
            }, panelId === undefined ? null : panelId);
            return h.workState();
        },

        /** Set the width state through the width control. → the resolved state */
        async width(state) {
            await evalFn((want) => {
                const btn = document.querySelector(`.chat-work-head [data-width="${want}"]`);
                if (!btn) throw new Error(`no width control for "${want}"`);
                btn.click();
                return true;
            }, state);
            return (await h.workState()).width;
        },

        /** What the workbench says about itself, straight off the DOM + app.work. */
        workState: () => evalFn(() => {
            const el = document.querySelector('.chat-work');
            const app = window.LolChat && window.LolChat.app;
            const work = app && app.work;
            return {
                present: !!el,
                hidden: !el || el.classList.contains('hidden'),
                width: (el && el.dataset && el.dataset.width) || (work && work.width && work.width()) || 'chat',
                panel: work && work.current ? work.current() : null,
                panels: work && work.panels ? work.panels().map((p) => p.id) : [],
                columns: getComputedStyle(document.getElementById('lolchat')).gridTemplateColumns,
            };
        }),

        // ---- h.graph: an ALIAS of h.computer (K1 landing, COMPUTER_PLAN §3.7) ---------------
        // It used to be its own namespace, pointed at `window.LolChat.debug.computer` (the
        // workbench panel) and `#lolchat .graph-*`. `graph/panel.mjs` is deleted, so the panel it
        // drove does not exist: the ~470 existing `h.graph.*` call sites in the C1/C2/C3 scenarios
        // now drive the STANDALONE surface, which is the whole point of the re-point pass. The
        // alias is installed just below the object literal, where `h.computer` is defined.

        // ---- the Computer, the standalone surface (K1 kickoff, COMPUTER_PLAN §2.1/§2.4) -------
        // The harness page has NO topbar: no .viewseg, no <webview>, and app.js is never loaded.
        // So h.view() does the one thing the page can do — flip the two sections' classes, exactly
        // as app.js's show() does — and returns what is showing. Everything about the segmented
        // control itself is a rig item, not a harness assertion.
        //
        // h.computer.* is h.graph.* pointed at window.LolComputer.debug.computer and
        // `#lolcomputer .graph-*`. Both namespaces coexist during K1 so the ~470 existing h.graph
        // call sites keep driving the chat's panel while the units build; at the K1 LANDING the
        // panel is deleted and `h.graph` becomes an ALIAS of `h.computer` (§3.7), which is why
        // every K1 scenario is written against h.computer from the start.

        /**
         * Show one surface. name: 'chat' | 'computer' | 'owui' (owui hides both sections here).
         * Waits for window.LolComputer.ready when switching to the Computer.
         * @returns {Promise<{view: string, chat: boolean, computer: boolean}>}
         */
        async view(name) {
            const want = name === undefined ? 'chat' : String(name);
            await evalFn((v) => {
                const chat = document.getElementById('lolchat');
                const computer = document.getElementById('lolcomputer');
                if (!chat || !computer) throw new Error('h.view: page.html is missing #lolchat or #lolcomputer');
                chat.classList.toggle('hidden', v !== 'chat');
                computer.classList.toggle('hidden', v !== 'computer');
                document.body.dataset.view = v;
                return true;
            }, want);
            if (want === 'computer') {
                await waitFor(() => !!(window.LolComputer && window.LolComputer.ready));
            }
            return evalFn(() => ({
                view: document.body.dataset.view || '',
                chat: !document.getElementById('lolchat').classList.contains('hidden'),
                computer: !document.getElementById('lolcomputer').classList.contains('hidden'),
            }));
        },

        computer: {
            /** Show the Computer surface. → {view, chat, computer} */
            open: () => h.view('computer'),
            /** @param {string} name @param {any[]} args one debug method, by name */
            call: (name, ...args) => evalFn((n, a) => {
                const dbg = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.computer;
                if (!dbg) throw new Error('no window.LolComputer.debug.computer: the Computer has not mounted');
                if (typeof dbg[n] !== 'function') throw new Error(`debug.computer has no ${n}()`);
                return dbg[n](...a);
            }, name, args),
            doc: () => h.computer.call('doc'),
            state: () => h.computer.call('state'),
            place: (type, x, y) => h.computer.call('place', type, x, y),
            remove: (ids) => h.computer.call('remove', ids),
            wire: (from, to, port) => h.computer.call('wire', from, to, port),
            unwire: (id) => h.computer.call('unwire', id),
            select: (ids) => h.computer.call('select', ids),
            move: (id, x, y) => h.computer.call('move', id, x, y),
            set: (id, patch) => h.computer.call('setSettings', id, patch),
            run: (opts) => h.computer.call('run', opts || {}),
            stop: () => h.computer.call('stop'),
            running: () => h.computer.call('running'),
            undo: () => h.computer.call('undo'),
            redo: () => h.computer.call('redo'),
            save: () => h.computer.call('save'),
            tidy: () => h.computer.call('tidy'),
            exportText: (o) => h.computer.call('exportText', o || {}),
            importText: (text, o) => h.computer.call('importText', text, o || {}),
            // ---- K2 (COMPUTER_PLAN §5, §8.1) --------------------------------------------------
            /** Name a wire — the same undoable edit the label pill makes. → boolean */
            label: (wireId, text) => h.computer.call('label', wireId, String(text == null ? '' : text)),
            /** The prompt a thinking part WOULD send, without sending it. → InstructionPlan|null */
            preview: (partId) => h.computer.call('preview', partId),
            /** The transcript drawer: open it on a part, read which tab is up, close it.
             * `tab` is 'sent' | 'got' | 'cost'. */
            transcript: {
                open: (partId, tab) => evalFn((id, which) => {
                    const tx = window.LolComputer && window.LolComputer.app && window.LolComputer.app.transcript;
                    if (!tx) throw new Error('no app.transcript: the transcript feature has not installed');
                    return tx.open(id, which || undefined);
                }, partId, tab || ''),
                close: () => evalFn(() => {
                    const tx = window.LolComputer && window.LolComputer.app && window.LolComputer.app.transcript;
                    return tx ? tx.close() : false;
                }),
                /** {open, tab, part, panel, text} — what the drawer is actually showing. */
                state: () => evalFn(() => {
                    const app = window.LolComputer && window.LolComputer.app;
                    const tx = app && app.transcript;
                    const drawer = app && app.drawer;
                    const body = document.querySelector('#lolcomputer .comp-tx-body');
                    return {
                        open: !!(tx && tx.isOpen()),
                        tab: tx ? tx.tab() : '',
                        part: tx && typeof tx.part === 'function' ? tx.part() : '',
                        panel: drawer && typeof drawer.panel === 'function' ? drawer.panel() : '',
                        drawerOpen: !!(drawer && drawer.isOpen && drawer.isOpen()),
                        tabs: Array.from(document.querySelectorAll('#lolcomputer .comp-tx-tab'))
                            .map((el) => ({ tab: el.getAttribute('data-tab'), on: el.getAttribute('aria-pressed') === 'true' })),
                        text: body ? body.textContent : null,
                    };
                }),
            },
            // ---- K3 (COMPUTER_PLAN §4, §6.6, §7.3) --------------------------------------------
            /** Press ▶ on ONE box: push, plus the §4.2 unrun-ancestor prologue. → RunReport */
            runFrom: (partId, opts) => h.computer.call('runFrom', partId, opts || {}),
            /** Every stored run for the open document, oldest first (§7.3). → RunJournal[] */
            journal: () => h.computer.call('journal'),
            /** What is parked right now (§4.1). → ParkRequest[] */
            waits: () => h.computer.call('waits'),
            /** Click a part's own ▶ in its title bar — the DOM gesture, not the door (K3-U3).
             * The frozen probe is `.graph-part-play[data-part="<id>"]`. */
            play: (partId) => evalFn((id) => {
                const el = document.querySelector('#lolcomputer .graph-part-play[data-part="' + id + '"]');
                if (!el) throw new Error('play: no ▶ on part ' + id);
                el.click();
                return true;
            }, partId),
            /** Press one of a parked part's inline controls — `ok`, `cancel`, `send`, `press`.
             * The frozen probe is `.graph-part-control[data-part][data-action]` (K3-U2). */
            control: (partId, action) => evalFn((id, act) => {
                const sel = '#lolcomputer [data-part="' + id + '"][data-action="' + act + '"]';
                const el = document.querySelector(sel);
                if (!el) throw new Error('control: no [' + act + '] on part ' + id);
                el.click();
                return true;
            }, partId, action),
            /** Answer a waiting Dialog: type into its field, then Send. */
            answer: async (partId, text) => {
                await evalFn((id, v) => {
                    const el = document.querySelector('#lolcomputer .graph-part-answer[data-part="' + id + '"]');
                    if (!el) throw new Error('answer: no field on part ' + id);
                    el.value = v;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    return true;
                }, partId, String(text == null ? '' : text));
                return h.computer.control(partId, 'send');
            },
            /** Every part's state and every wire's barred/back flags, straight off the DOM —
             * what §8.3 says a reader can distinguish, asserted the way a reader sees it. */
            states: () => evalFn(() => ({
                parts: Array.from(document.querySelectorAll('#lolcomputer .graph-part'))
                    .map((el) => ({ id: el.getAttribute('data-id'), state: el.getAttribute('data-state') })),
                wires: Array.from(document.querySelectorAll('#lolcomputer .graph-wire'))
                    .map((el) => ({
                        wire: el.getAttribute('data-wire'),
                        barred: el.getAttribute('data-barred') === 'true',
                        back: el.getAttribute('data-back') === 'true',
                    })),
                plays: Array.from(document.querySelectorAll('#lolcomputer .graph-part-play'))
                    .map((el) => el.getAttribute('data-part')),
                runbar: (document.querySelector('#lolcomputer .comp-run') || {}).textContent || '',
            })),

            // ---- K5 (addendum KE-2, KE-6): the ＋ menu, the first-run offer and the tutorial,
            // driven the way a PERSON drives them — by clicking the visible control (build rule 6).
            // Nothing here calls a debug door to place a box: `add()` clicks ＋, types, clicks a row.
            menu: {
                /** Click the toolbar's ＋. → the rows now showing (see `rows`). */
                open: async () => {
                    await click('#lolcomputer .graph-add');
                    return h.computer.menu.rows();
                },
                /** A double-click (how='dblclick', the default) or a right-click (how='contextmenu')
                 * on the canvas at (x, y) px from its top-left corner. → {open, rows} */
                openAt: async (x, y, how) => {
                    await evalFn((px, py, kind) => {
                        const c = document.querySelector('#lolcomputer .graph-canvas');
                        if (!c) throw new Error('menu.openAt: no canvas');
                        const r = c.getBoundingClientRect();
                        c.dispatchEvent(new MouseEvent(kind, { bubbles: true, cancelable: true, clientX: r.left + px, clientY: r.top + py, button: kind === 'contextmenu' ? 2 : 0 }));
                        return true;
                    }, x, y, how || 'dblclick');
                    return { open: await h.computer.menu.isOpen(), rows: await h.computer.menu.rows() };
                },
                isOpen: () => evalFn(() => {
                    const m = document.querySelector('#lolcomputer .graph-add-menu');
                    return !!m && !m.hidden;
                }),
                /** The rows the OPEN menu is showing, in drawn order. */
                rows: () => evalFn(() => Array.from(document.querySelectorAll('#lolcomputer .graph-add-menu:not([hidden]) .graph-add-item'))
                    .map((el) => ({
                        entry: el.getAttribute('data-entry'),
                        type: el.getAttribute('data-type'),
                        group: el.getAttribute('data-group'),
                        preset: el.getAttribute('data-preset'),
                        label: ((el.querySelector('.graph-add-name') || {}).textContent) || '',
                        desc: ((el.querySelector('.graph-add-desc') || {}).textContent) || '',
                        glyph: ((el.querySelector('.graph-add-glyph') || {}).textContent) || '',
                        active: el.getAttribute('aria-selected') === 'true',
                    }))),
                /** The group headings the OPEN menu is showing, in order. */
                groups: () => evalFn(() => Array.from(document.querySelectorAll('#lolcomputer .graph-add-menu:not([hidden]) .graph-add-group'))
                    .map((el) => ({ group: el.getAttribute('data-group'), label: el.textContent }))),
                /** Type into the search box, as a person would. → rows */
                search: async (q) => {
                    await evalFn((v) => {
                        const el = document.querySelector('#lolcomputer .graph-add-menu:not([hidden]) .graph-add-search');
                        if (!el) throw new Error('menu.search: the menu is not open');
                        el.focus();
                        el.value = v;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        return true;
                    }, String(q == null ? '' : q));
                    return h.computer.menu.rows();
                },
                /** Press a key in the open menu (ArrowDown, ArrowUp, Enter, Escape). */
                key: (k) => evalFn((key) => {
                    const el = document.querySelector('#lolcomputer .graph-add-menu:not([hidden]) .graph-add-search')
                        || document.querySelector('#lolcomputer .graph-add-menu:not([hidden])');
                    if (!el) throw new Error('menu.key: the menu is not open');
                    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
                    return true;
                }, k),
                /** Click one row of the open menu. → the id of the part it placed, or null. */
                pick: async (entry) => {
                    const before = (await h.computer.state()).parts.map((p) => p.id);
                    await click(`#lolcomputer .graph-add-menu:not([hidden]) .graph-add-item[data-entry="${entry}"]`);
                    const after = (await h.computer.state()).parts.map((p) => p.id);
                    return after.find((id) => before.indexOf(id) < 0) || null;
                },
            },
            /** ＋ → (optionally type `opts.query`) → click the row `entry`. → the new part's id. */
            add: async (entry, opts) => {
                await h.computer.menu.open();
                if (opts && opts.query) await h.computer.menu.search(opts.query);
                return h.computer.menu.pick(entry);
            },
            /** The first-run offer on an empty canvas: {shown, actions}. `press(action)` clicks one. */
            welcome: {
                state: () => evalFn(() => {
                    const el = document.querySelector('#lolcomputer .comp-welcome');
                    return {
                        shown: !!el && !el.hidden,
                        actions: el ? Array.from(el.querySelectorAll('.comp-welcome-btn')).filter((b) => !b.hidden).map((b) => b.getAttribute('data-action')) : [],
                    };
                }),
                press: (action) => click(`#lolcomputer .comp-welcome:not([hidden]) .comp-welcome-btn[data-action="${action}"]`),
            },
            /** The Learn shelf and the step rail (KE-6 probes). */
            tutorial: {
                /** Click a lesson on the Learn shelf. */
                openLesson: (id) => click(`#lolcomputer .comp-lesson[data-lesson="${id}"]`),
                /** Click a template on the Learn shelf. */
                openTemplate: (id) => click(`#lolcomputer .comp-template[data-template="${id}"]`),
                /** What the rail shows right now. */
                rail: () => evalFn(() => {
                    const rail = document.querySelector('#lolcomputer .comp-rail');
                    const txt = (sel) => { const el = rail && rail.querySelector(sel); return el ? el.textContent : null; };
                    return {
                        shown: !!rail && !rail.classList.contains('hidden'),
                        lesson: rail ? rail.getAttribute('data-lesson') : null,
                        step: txt('.comp-rail-step'),
                        text: txt('.comp-rail-text'),
                        show: txt('.comp-rail-show'),
                        gotIt: !!(rail && rail.querySelector('.comp-rail-got')),
                        demo: !!(rail && rail.querySelector('.comp-rail-demo')),
                        next: txt('.comp-rail-next'),
                    };
                }),
                /** Click one of the rail's buttons: 'show' | 'got' | 'reset' | 'demo' | 'next'. */
                press: (what) => click(`#lolcomputer .comp-rail .comp-rail-${what}`),
                /** app.tutorial's own view: {loaded, progress, current, rail}. */
                debug: () => evalFn(() => {
                    const tut = window.LolComputer && window.LolComputer.app && window.LolComputer.app.tutorial;
                    return tut ? tut.debug() : null;
                }),
            },

            /** What the two Apps share, and what they must not (COMPUTER_PLAN §2.3). */
            spine: () => evalFn(() => {
                const chat = window.LolChat && window.LolChat.app;
                const comp = window.LolComputer && window.LolComputer.app;
                return {
                    ready: !!(window.LolComputer && window.LolComputer.ready),
                    failed: Object.keys((window.LolComputer && window.LolComputer.failed) || {}),
                    sameApp: !!chat && chat === comp,
                    sameRepo: !!chat && !!comp && chat.repo === comp.repo,
                    sameFarm: !!chat && !!comp && chat.farm === comp.farm,
                    sameGov: !!chat && !!comp && chat.gov === comp.gov,
                    sameBus: !!chat && !!comp && chat.bus === comp.bus,
                    visible: !!(comp && comp.state && comp.state.visible),
                };
            }),
            /** The migration verdict (§7.2). */
            migration: () => evalFn(() => (window.LolComputer && window.LolComputer.migration) || null),
            /** What is actually in the DOM on the Computer surface. */
            dom: () => evalFn(() => {
                const layer = document.querySelector('#lolcomputer .graph-layer');
                const svg = document.querySelector('#lolcomputer .graph-wires');
                return {
                    root: !!document.querySelector('#lolcomputer .graph'),
                    side: !!document.querySelector('#lolcomputer .comp-side'),
                    runbar: !!document.querySelector('#lolcomputer .comp-runbar'),
                    drawer: !!document.querySelector('#lolcomputer .comp-drawer'),
                    hidden: document.getElementById('lolcomputer').classList.contains('hidden'),
                    chatHidden: document.getElementById('lolchat').classList.contains('hidden'),
                    chatPresent: !!document.getElementById('lolchat'),
                    parts: document.querySelectorAll('#lolcomputer .graph-part').length,
                    wires: svg ? svg.querySelectorAll('path').length : 0,
                    transform: layer ? getComputedStyle(layer).transform : '',
                    states: Array.from(document.querySelectorAll('#lolcomputer .graph-part'))
                        .map((el) => el.getAttribute('data-state')),
                    // K2: the label pill on each wire (§8.2). `null` where a wire has no pill yet;
                    // '' is an EMPTY pill, which draws as the dashed `name me` placeholder.
                    labels: Array.from(document.querySelectorAll('#lolcomputer .graph-wire-label'))
                        .map((el) => ({ wire: el.getAttribute('data-wire'), text: el.textContent })),
                    transcript: !!document.querySelector('#lolcomputer .comp-tx'),
                };
            }),
        },

        ask: {
            /**
             * The ask spine's completed calls: [{task, mode, ok, ms, model}] (app/ask.mjs debug).
             *
             * K1 landing: there are TWO ask installs now, one per surface (COMPUTER_PLAN §2.3 —
             * `ask` reads its own app's `state.visible`, so it cannot be shared). A graph run's
             * calls land on the COMPUTER's log; a chat turn's on the chat's. Every existing caller
             * means "what did this client ask the farm", so both are merged — the chat's rows
             * first, then the Computer's, each in its own order (the rows carry no timestamp) —
             * and every row carries `surface` for a scenario that needs to tell them apart.
             */
            log: () => evalFn(() => {
                const read = (/** @type {any} */ root, /** @type {string} */ surface) => {
                    const dbg = root && root.debug && root.debug.ask;
                    const rows = dbg && typeof dbg.log === 'function' ? dbg.log() : [];
                    return rows.map((/** @type {any} */ r) => Object.assign({ surface }, r));
                };
                return read(window.LolChat, 'chat').concat(read(window.LolComputer, 'computer'));
            }),
        },

        /** The projects backend as the PAGE sees it (real when the build is wired, else memory). */
        projects: {
            kind: () => evalFn(() => {
                const app = window.LolChat && window.LolChat.app;
                return app && app.projects ? app.projects.kind() : 'absent';
            }),
            root: () => evalFn(() => window.LolChat.app.projects.root()),
            list: () => evalFn(() => window.LolChat.app.projects.list()),
            files: (id) => evalFn((i) => window.LolChat.app.projects.listFiles(i), id),
            read: (id, rel) => evalFn((i, r) => window.LolChat.app.projects.read(i, r), id, rel),
        },

        /** The files actually on disk under <tmp>/projects/<id> (the real backend only). */
        files(id) {
            const dir = path.join(tmpDir, 'projects', String(id));
            /** @type {{path: string, size: number}[]} */
            const out = [];
            const walk = (abs, rel) => {
                let entries = [];
                try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
                for (const e of entries) {
                    const next = path.join(abs, e.name);
                    const key = rel ? `${rel}/${e.name}` : e.name;
                    if (e.isDirectory()) walk(next, key);
                    else out.push({ path: key, size: fs.statSync(next).size });
                }
            };
            walk(dir, '');
            return out.sort((a, b) => (a.path < b.path ? -1 : 1));
        },

        /** shell.showItemInFolder / shell.openPath calls the main process RECORDED (never made). */
        shellCalls: () => readLog('shellCalls'),

        windowOpens: () => readLog('windowOpens'),
        downloads: () => readLog('downloads'),
        markLogs,

        // A show:false BrowserWindow has no on-screen surface, so Chromium produced no compositor
        // frames for it and Page.captureScreenshot never resolved (measured at the P0 landing on
        // Electron 42.5.1, with and without fromSurface:false). Since the P1 landing run.js keeps a
        // tiny CDP screencast open, which gives the window a frame CONSUMER, a hidden window paints
        // and photographs normally — `p1-shots-{dark,light}` DEMAND a real PNG with no
        // --show. The 6 s give-up below stays as the safety net for an environment where the frame
        // pump is unavailable: return null with a note rather than hang the scenario, and remember
        // the verdict FOR THE WHOLE RUN (waiting 6 s again on every later call cost ~70 % of a P0
        // run and left one CDP request pending per call).
        async screenshot(name) {
            if (noScreenshots) {
                ctx.notes.push('screenshot unavailable (hidden window) — rerun with --show for ' + name);
                return null;
            }
            const TIMED_OUT = Symbol('timeout');
            const shot = cdp.send('Page.captureScreenshot', { format: 'png' });
            const r = await Promise.race([
                shot.then((v) => v, (err) => ({ error: err })),
                sleep(6000).then(() => TIMED_OUT),
            ]);
            if (r === TIMED_OUT) {
                noScreenshots = true;                       // a hidden window: never try again this run
                ctx.notes.push('screenshot unavailable (hidden window) — rerun with --show for ' + name);
                return null;
            }
            if (!r || !r.data) {
                const why = r && r.error ? String(r.error.message || r.error) : 'no image data';
                ctx.notes.push('screenshot FAILED for ' + name + ': ' + why);
                return null;                                 // transient: the next call tries again
            }
            fs.mkdirSync(ctx.shotsDir, { recursive: true });
            const file = path.join(ctx.shotsDir, String(name).replace(/[^\w.-]+/g, '_') + '.png');
            fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
            return file;
        },

        // harness-bridge controls
        setFarm: (patch) => evalFn((p) => window.__harness.setFarm(p), patch === undefined ? null : patch),
        pause: (on) => evalFn((o) => window.__harness.pause(o), !!on),
        setPageVisible: (v) => evalFn((o) => window.__harness.setPageVisible(o), !!v),
        publishFarm: () => evalFn(() => window.__harness.publish()),
        harnessState: () => evalFn(() => window.__harness.state()),

        consoleErrors: () => ctx.consoleErrors.slice(),
        note: (msg) => { ctx.notes.push(String(msg)); return msg; },
        sleep,

        assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); return true; },
        eq(a, b, msg) {
            const sa = JSON.stringify(a), sb = JSON.stringify(b);
            if (sa !== sb) throw new Error((msg || 'not equal') + ': got ' + sa + ', want ' + sb);
            return true;
        },
    };
    // §3.7: h.graph IS h.computer. One object, two names, so no scenario had to be rewritten
    // call-by-call and no assertion changed meaning without being read.
    h.graph = h.computer;

    return h;
}

module.exports = { createHelpers, req, sleep };
