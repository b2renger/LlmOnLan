// @ts-check
// LOL Vibe's IDE (docs/IDE_PLAN.md), in the real page with the REAL runner (build/main/studio.js) over the mock dsh
// (test/mock-dsh.mjs — the SDK's wire and event shapes; it really writes and edits files):
//   1. The Project panel makes a project and binds the thread to it (thread.studio.projectId).
//   2. A message in that thread is answered by the agent, in the project folder: the file appears in the panel, the
//      reply shows the step log, and the Preview frame shows the page served on 127.0.0.1 (main's frame veto lets
//      exactly that origin through).
//   3. The next message edits the file: the Changes tab shows the old and the new text.
//   4. Stop ends a running turn at once; the reply says it was stopped.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Send in the CURRENT thread (h.submit starts a new one, which would unbind the project). */
const send = (/** @type {any} */ h, /** @type {string} */ text) => h.eval((v) => {
    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('chat-input'));
    const form = /** @type {HTMLFormElement} */ (document.getElementById('chat-form'));
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(input, v); else input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    return true;
}, text);

/** The n-th assistant row once it is no longer streaming. */
const settled = (/** @type {any} */ h, /** @type {number} */ n) => h.waitFor((k) => {
    const rows = Array.from(document.querySelectorAll('#lolchat .chat-msg.assistant'));
    const r = rows[k - 1];
    const st = r && r.getAttribute('data-status');
    if (!r || !st || st === 'streaming') return null;
    const body = r.querySelector('.chat-body');
    const reasoning = r.querySelector('.chat-reasoning');
    const stats = r.querySelector('.chat-stats');
    return { status: st, text: body ? body.textContent : '', reasoning: reasoning ? reasoning.textContent : '', stats: stats ? stats.textContent.trim() : '' };
}, { timeout: 20000, args: [n] });

const panel = (/** @type {any} */ h) => h.eval(() => (window.LolChat.debug.project ? window.LolChat.debug.project.state() : null));

export default [
    {
        name: 'k24-the-ide-binds-a-project-the-agent-writes-and-edits-it-and-the-preview-shows-it',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.waitFor(() => (window.LolChat && window.LolChat.ready ? true : null));
            h.eq(await h.eval(() => !!(window.lol && window.lol.studio)), true, 'the harness wired the runner (build/main/studio.js)');

            // 1. Open the Project panel, make a project.
            await h.eval(() => { window.LolChat.app.work.open('project'); return true; });
            await h.waitFor(() => (document.querySelector('#lolchat .chat-proj-empty:not([hidden]) .chat-proj-name-in') ? true : null));
            await h.eval(() => {
                const input = /** @type {HTMLInputElement} */ (document.querySelector('#lolchat .chat-proj-name-in'));
                input.value = 'cube';
                /** @type {HTMLFormElement} */ (document.querySelector('#lolchat .chat-proj-new')).requestSubmit();
                return true;
            });
            const bound = await h.waitFor(() => {
                const s = window.LolChat.debug.project && window.LolChat.debug.project.state();
                return s && s.projectId && s.serveUrl ? s : null;
            }, { timeout: 15000 });
            h.assert(/^cube-[a-z0-9]{8}$/.test(bound.projectId), `a project id: ${bound.projectId}`);
            h.assert(/^http:\/\/127\.0\.0\.1:\d+\/$/.test(bound.serveUrl), `served on loopback: ${bound.serveUrl}`);
            const stored = await h.eval(async () => {
                const app = window.LolChat.app;
                const th = await app.repo.getThread(app.state.threadId);
                return th && th.studio ? th.studio.projectId : null;
            });
            h.eq(stored, bound.projectId, 'the thread is bound to the project in the store');

            // 2. The agent writes the page.
            await send(h, 'write index.html: <h1 id="hi">hello</h1>');
            const first = await settled(h, 1);
            h.eq(first.status, 'done', `the agent's reply: ${first.text}`);
            h.assert(/Done\. I saw: write index\.html/.test(first.text), `the agent answered: ${first.text}`);
            h.assert(!/Earlier in this conversation/.test(first.text), 'no recap on a first message');
            h.assert(/→ write index\.html ✓/.test(first.reasoning), `the step log: ${first.reasoning}`);
            h.assert(/^1 step · \d+\.\d s$/.test(first.stats), `steps and seconds, never tok/s: ${first.stats}`);
            const shown = await h.waitFor(() => {
                const s = window.LolChat.debug.project.state();
                return s.files.includes('index.html') && s.frame ? s : null;
            }, { timeout: 15000 });
            h.assert(shown.frame.startsWith(`${bound.serveUrl}index.html?r=`), `the Preview shows the served page: ${shown.frame}`);
            const page = await h.eval(async (url) => (await fetch(url)).text(), `${bound.serveUrl}index.html`);
            h.eq(page, '<h1 id="hi">hello</h1>', 'the page the agent wrote is what the server serves');
            const inFrame = await h.waitFor(() => {
                const f = /** @type {HTMLIFrameElement|null} */ (document.querySelector('#lolchat .chat-proj-frame'));
                return f && f.getBoundingClientRect().height > 100 ? true : null;
            }, { timeout: 10000 });
            h.assert(inFrame, 'the Preview frame is on screen');
            const dropped = (await h.windowOpens()).filter((w) => w.frameNavigate && String(w.url).startsWith(bound.serveUrl));
            h.eq(dropped, [], 'main\'s frame veto let the served page in (an empty frame would look the same)');

            // 3. The agent edits it; the Changes tab shows the edit.
            await send(h, 'replace hello with world in index.html');
            const second = await settled(h, 2);
            h.eq(second.status, 'done');
            h.assert(/→ edit index\.html ✓ \(1 change\)/.test(second.reasoning), `the edit step: ${second.reasoning}`);
            await h.click('#lolchat .chat-proj-tab-changes');
            const diff = await h.waitFor(() => {
                const pre = document.querySelector('#lolchat .chat-proj-pane-changes:not([hidden]) .chat-proj-diff');
                return pre ? pre.textContent : null;
            }, { timeout: 10000 });
            h.assert(/- hello/.test(diff) && /\+ world/.test(diff), `the Changes tab: ${diff}`);
            await h.screenshot('k24-ide-changes');
            h.eq((await panel(h)).frame, null, 'the Preview frame is gone while another tab is up (hidden means idle)');

            // 4. Stop ends a running turn.
            await send(h, 'slow');
            await h.waitFor(() => (document.querySelector('#lolchat .chat-msg.assistant[data-status="streaming"]') ? true : null), { timeout: 10000 });
            await h.eval(() => { window.LolChat.app.controller.stop(); return true; });
            const third = await settled(h, 3);
            h.eq(third.status, 'aborted', 'Stop stopped the agent');
            h.eq(await h.eval(async () => (await window.lol.studio.status()).running), false, 'main has no turn running');
        },
    },
];
