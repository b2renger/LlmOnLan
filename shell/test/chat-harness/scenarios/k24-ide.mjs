// @ts-check
// LOL Vibe's IDE (docs/IDE_PLAN.md), in the real page with the REAL runner (build/main/studio.js) over the mock dsh
// (test/mock-dsh.mjs — the SDK's wire and event shapes; it really writes and edits files):
//   1. The Project panel makes a project and binds the thread to it (thread.studio.projectId).
//   2. A message in that thread is answered by the agent, in the project folder: the file appears in the panel, the
//      reply shows the step log, and the Preview frame shows the page served on 127.0.0.1 (main's frame veto lets
//      exactly that origin through).
//   3. The next message edits the file: the Changes tab shows the old and the new text, and the Code tab (opened on
//      the file before, left for the Preview) holds the new text — so does it after Go back.
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
        timeoutMs: 180000,
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

            // The model line follows the picker: the default (`assistant`, Qwen3.8 behind the alias) is good at edits;
            // a person switching to gemma4 gets the warning at once; switching back clears it.
            const line = (/** @type {RegExp} */ re, /** @type {boolean} */ warn) => h.waitFor((src, w) => {
                const p = document.querySelector('#lolchat .chat-proj-model');
                return p && new RegExp(src).test(p.textContent || '') && p.classList.contains('is-warn') === w ? p.textContent : null;
            }, { timeout: 20000, args: [re.source, warn] });
            h.assert(/Qwen3\.8/.test(await line(/good at editing code/, false)), 'judged on the model behind the alias');
            const pick = (/** @type {string} */ id) => h.eval((v) => {
                const s = /** @type {HTMLSelectElement} */ (document.getElementById('chat-model'));
                s.value = v;
                s.dispatchEvent(new Event('change', { bubbles: true }));
                return s.value;
            }, id);
            h.eq(await pick('gemma4:12b'), 'gemma4:12b');
            await line(/weak at editing code/, true);
            await pick('assistant');
            await line(/good at editing code/, false);

            // Share on the LAN: off by default; the toggle shows the address (the harness listens on loopback and
            // answers to a TEST-NET name), and turning it off clears it.
            h.eq((await panel(h)).lan, [], 'not shared by default');
            await h.click('#lolchat .chat-proj-share');
            const lan = await h.waitFor(() => {
                const s = window.LolChat.debug.project.state();
                const note = document.querySelector('#lolchat .chat-proj-share-note');
                return s.lan.length && note && /192\.0\.2\.10/.test(note.textContent || '') ? s.lan : null;
            }, { timeout: 20000 });
            h.assert(/^http:\/\/192\.0\.2\.10:\d+\/$/.test(lan[0]), `the LAN address: ${lan[0]}`);
            h.eq(await h.eval(() => document.querySelector('#lolchat .chat-proj-share').getAttribute('aria-pressed')), 'true');
            await h.click('#lolchat .chat-proj-share');
            await h.waitFor(() => (window.LolChat.debug.project.state().lan.length ? null : true), { timeout: 20000 });

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
            }, { timeout: 20000 });
            h.assert(inFrame, 'the Preview frame is on screen');
            const dropped = (await h.windowOpens()).filter((w) => w.frameNavigate && String(w.url).startsWith(bound.serveUrl));
            h.eq(dropped, [], 'main\'s frame veto let the served page in (an empty frame would look the same)');

            // The Code tab follows the files whichever tab is up: open index.html there, go back to the Preview; after
            // the next reply the Code tab holds the agent's edit (a stale one's Save was refused).
            await h.eval(() => {
                const b = Array.from(document.querySelectorAll('#lolchat .chat-proj-file')).find((x) => x.textContent === 'index.html');
                /** @type {any} */ (b).click();
                return true;
            });
            await h.waitFor(() => (/hello/.test(/** @type {HTMLTextAreaElement} */ (document.querySelector('#lolchat .chat-proj-code')).value) ? true : null), { timeout: 20000 });
            h.eq((await panel(h)).tab, 'code', 'a text file opens in the Code tab');
            await h.click('#lolchat .chat-proj-tab-preview');

            // 3. The agent edits it; the Changes tab shows the edit.
            await send(h, 'replace hello with world in index.html');
            const second = await settled(h, 2);
            h.eq(second.status, 'done');
            h.assert(/→ edit index\.html ✓ \(1 change\)/.test(second.reasoning), `the edit step: ${second.reasoning}`);
            await h.click('#lolchat .chat-proj-tab-changes');
            const diff = await h.waitFor(() => {
                const pre = document.querySelector('#lolchat .chat-proj-pane-changes:not([hidden]) .chat-proj-diff');
                return pre ? pre.textContent : null;
            }, { timeout: 20000 });
            h.assert(/- hello/.test(diff) && /\+ world/.test(diff), `the Changes tab: ${diff}`);
            await h.screenshot('k24-ide-changes');
            await h.click('#lolchat .chat-proj-tab-code');
            await h.waitFor(() => (/world/.test(/** @type {HTMLTextAreaElement} */ (document.querySelector('#lolchat .chat-proj-code')).value) ? true : null), { timeout: 20000 });
            h.eq((await panel(h)).tab, 'code');

            // History (projectGit.ts): each reply is a commit; going back is a new commit, so it can be undone too.
            await h.click('#lolchat .chat-proj-tab-history');
            const log = await h.waitFor(() => {
                const s = window.LolChat.debug.project.state();
                const pre = document.querySelector('#lolchat .chat-proj-pane-history:not([hidden]) .chat-proj-diff');
                return s.history.length === 2 && pre ? { history: s.history, diff: pre.textContent } : null;
            }, { timeout: 20000 });
            h.eq(log.history, ['Agent: replace hello with world in index.html', 'Agent: write index.html: <h1 id="hi">hello</h1>'], 'one commit per reply, newest first');
            h.assert(/- <h1 id="hi">hello<\/h1>/.test(log.diff) && /\+ <h1 id="hi">world<\/h1>/.test(log.diff), `the newest commit's diff: ${log.diff}`);
            await h.click('#lolchat .chat-proj-commit-row:nth-child(2) .chat-proj-commit');
            await h.waitFor(() => (document.querySelector('#lolchat .chat-proj-go-back') ? true : null), { timeout: 20000 });
            await h.click('#lolchat .chat-proj-go-back');
            const after = await h.waitFor(() => {
                const s = window.LolChat.debug.project.state();
                return s.history.length === 3 ? s.history : null;
            }, { timeout: 20000 });
            h.eq(after[0], 'Back to: Agent: write index.html: <h1 id="hi">hello</h1>');
            h.eq(await h.eval(async (url) => (await fetch(url)).text(), `${bound.serveUrl}index.html`), '<h1 id="hi">hello</h1>', 'the page is back to the first reply');
            await h.waitFor(() => (/hello/.test(/** @type {HTMLTextAreaElement} */ (document.querySelector('#lolchat .chat-proj-code')).value) ? true : null), { timeout: 20000 });
            await h.screenshot('k24-ide-history');

            // GitHub: an https address only; a token is kept (the field clears, the page never reads it back); a push to
            // an unreachable host is a sentence. (The real protocol is tested in project-git-remote.test.mjs.)
            const gitNote = () => h.eval(() => (document.querySelector('#lolchat .chat-proj-git-note') || {}).textContent || '');
            const typeInto = (/** @type {string} */ sel, /** @type {string} */ v) => h.eval((s, x) => {
                const i = /** @type {HTMLInputElement} */ (document.querySelector(s)); i.value = x; return true;
            }, sel, v);
            await h.eval(() => { /** @type {any} */ (document.querySelector('#lolchat .chat-proj-git')).open = true; return true; });
            await typeInto('#lolchat .chat-proj-remote-in', 'http://example.com/me/site.git');
            await h.click('#lolchat .chat-proj-save-remote');
            const refused = await h.waitFor(() => {
                const n = document.querySelector('#lolchat .chat-proj-git-note');
                return n && /https:\/\//.test(n.textContent || '') ? n.textContent : null;
            }, { timeout: 20000 });
            h.assert(/Type the https:\/\/ address/.test(refused), `an http address is refused in words: ${refused}`);
            await typeInto('#lolchat .chat-proj-remote-in', 'https://127.0.0.1:9/me/site.git');
            await h.click('#lolchat .chat-proj-save-remote');
            await h.waitFor(() => (/Address saved/.test((document.querySelector('#lolchat .chat-proj-git-note') || {}).textContent || '') ? true : null), { timeout: 20000 });
            h.assert(/No token for 127\.0\.0\.1:9/.test(await h.eval(() => document.querySelector('#lolchat .chat-proj-token-note').textContent)), 'says how to get a token');
            await typeInto('#lolchat .chat-proj-token-in', 'ghp_harness_token_1');
            await h.click('#lolchat .chat-proj-save-token');
            await h.waitFor(() => (/A token is kept for 127\.0\.0\.1:9/.test((document.querySelector('#lolchat .chat-proj-token-note') || {}).textContent || '') ? true : null), { timeout: 20000 });
            h.eq(await h.eval(() => /** @type {HTMLInputElement} */ (document.querySelector('#lolchat .chat-proj-token-in')).value), '', 'the token field clears');
            await h.click('#lolchat .chat-proj-push');
            await h.waitFor(() => (/Could not push \(127\.0\.0\.1:9\)/.test((document.querySelector('#lolchat .chat-proj-git-note') || {}).textContent || '') ? true : null), { timeout: 20000 });
            h.assert(!/ghp_/.test(await gitNote()), 'no token in any sentence');

            // graphify: the agent writes graphify-out/graph.json; clicked in the file list, it is DRAWN in the Preview by
            // the Computer's viewer, in the panel's own sandbox guest (not the served page).
            await send(h, 'write graphify-out/graph.json: {"nodes":[{"id":"a","label":"App","community":0},{"id":"b","label":"Store","community":1},{"id":"c","label":"View","community":1}],"links":[{"source":"a","target":"b","relation":"calls"},{"source":"a","target":"c","relation":"imports"}]}');
            h.eq((await settled(h, 3)).status, 'done');
            await h.waitFor(() => (window.LolChat.debug.project.state().files.includes('graphify-out/graph.json') ? true : null), { timeout: 20000 });
            await h.eval(() => {
                const b = Array.from(document.querySelectorAll('#lolchat .chat-proj-file')).find((x) => x.textContent === 'graphify-out/graph.json');
                /** @type {any} */ (b).click();
                return true;
            });
            const drawn = await h.waitFor(() => {
                const s = window.LolChat.debug.project.state();
                const mount = /** @type {any} */ (document.querySelector('#lolchat .chat-proj-graph'));
                return s.tab === 'preview' && s.graph && !/stopped|stalled/.test(s.graph) && mount && !mount.hidden && mount.querySelector('iframe') ? s : null;
            }, { timeout: 20000 });
            h.eq(drawn.frame, null, 'the graph replaces the served page in the Preview');
            await h.screenshot('k24-ide-graph');
            h.eq((await panel(h)).frame, null, 'the Preview frame is gone while another tab is up (hidden means idle)');

            // A project chat is neither measured nor gated: the agent is sent only the new message, never this history
            // (the in-app review, 2026-09-28). With the threshold at 1 token a normal chat would hold every Send for a
            // second click, so the one-click send of step 4 below is the gate's check; the meter's is here.
            const wasThreshold = await h.eval(() => { const c = window.LolChat.app.context; const was = c.threshold(); c.setThreshold(1); return was; });
            await h.eval(() => {
                const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('chat-input'));
                input.value = 'a draft the meter would count';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            });
            await h.sleep(900);
            h.eq(await h.eval(() => {
                const m = /** @type {HTMLElement|null} */ (document.querySelector('#lolchat .chat-meter'));
                return m ? m.hidden : null;
            }), true, 'no context meter in a project chat');

            // 4. Stop ends a running turn (sent with ONE click, the threshold at 1).
            await send(h, 'slow');
            await h.waitFor(() => (document.querySelector('#lolchat .chat-msg.assistant[data-status="streaming"]') ? true : null), { timeout: 20000 });
            await h.eval(() => { window.LolChat.app.controller.stop(); return true; });
            const third = await settled(h, 4);
            h.eq(third.status, 'aborted', 'Stop stopped the agent');
            h.eq(await h.eval(async () => (await window.lol.studio.status()).running), false, 'main has no turn running');
            await h.eval((v) => { window.LolChat.app.context.setThreshold(v); return true; }, wasThreshold);

            // 5. Keep going until done (owner, 2026-09-29): a person's switch; dsh's rounds become ONE reply whose step log
            //    shows each round, and the goal the agent completed. The mock acts out dsh's goal loop (test/mock-dsh.mjs).
            const keep = () => h.eval(() => { /** @type {HTMLButtonElement} */ (document.querySelector('#lolchat .chat-proj-keep')).click(); return true; });
            h.eq((await panel(h)).keepGoing, false, 'off by default');
            await keep();
            h.eq((await panel(h)).keepGoing, true, 'on for this project');
            h.assert(/at most 10/.test(await h.eval(() => (document.querySelector('#lolchat .chat-proj-keep-note') || {}).textContent || '')), 'the note says what it does');
            await send(h, 'rounds 2: finish the job');
            const loop = await settled(h, 5);
            h.eq(loop.status, 'done', `the loop ends done: ${loop.text}`);
            h.assert(/Round 1 of 10[\s\S]*Round 2 of 10[\s\S]*Goal done/.test(loop.reasoning), `the step log shows each round, then the goal done: ${loop.reasoning.slice(0, 300)}`);
            h.assert(/Goal complete after 2 rounds/.test(loop.text), 'the last round\'s words are the answer');
            await h.waitFor(() => {
                const f = window.LolChat.debug.project.state().files;
                return f.includes('round-1.txt') && f.includes('round-2.txt') ? true : null;
            }, { timeout: 20000 });

            //    Stop in the middle of a loop ends it at once, like any reply.
            await send(h, 'rounds 6: a long job');
            await h.waitFor(() => (/Round 1 of 10/.test((document.querySelectorAll('#lolchat .chat-msg.assistant')[5] || {}).textContent || '') ? true : null), { timeout: 20000 });
            await h.eval(() => { window.LolChat.app.controller.stop(); return true; });
            h.eq((await settled(h, 6)).status, 'aborted', 'Stop ends the loop');
            h.eq(await h.eval(async () => (await window.lol.studio.status()).running), false, 'no loop left running in main');
            await keep();
            h.eq((await panel(h)).keepGoing, false, 'and the switch goes off again');
        },
    },
];
