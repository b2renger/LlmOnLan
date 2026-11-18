// @ts-check
// VIBE_PAGE_PLAN step 1 (owner, 2026-11-18): a page from an answer, its code beside it, edited live. In the real window:
//   k30-page-error-names-its-block-and-line   the message's Preview says which block and line; the Page panel lists
//                                              the error with its block and line, a click selects that line
//   k30-page-edit-runs-and-is-kept            typing a fix runs the page again (no error, the new console line), the
//                                              edit is on the answer's record and the view's copy, the block says
//                                              "edited", and the edit comes back after another thread; Back to the
//                                              model's code throws it away

const HTML = '<!DOCTYPE html>\n<html><body>\n<h1 id="t">Hello</h1>\n<button id="b">Go</button>\n</body></html>';
const CSS = 'h1 { color: rgb(200, 0, 0); }';
const JS = "const b = document.getElementById('b');\nconsole.log('ready ' + innerWidth);\nnope();";
const ANSWER = `Here is a small page.\n\n\`\`\`html\n${HTML}\n\`\`\`\n\n\`\`\`css\n${CSS}\n\`\`\`\n\n\`\`\`js\n${JS}\n\`\`\`\n`;

/** A thread with the question and the answer, on screen. */
const seed = (/** @type {any} */ h) => h.eval(async (answer) => {
    const app = window.LolChat.app;
    const th = app.repo.createThread({ title: 'A page' });
    app.repo.appendMessage(th.id, { role: 'user', content: 'a page', parts: [{ type: 'text', text: 'a page' }], status: 'done' });
    const msg = app.repo.appendMessage(th.id, { role: 'assistant', content: answer, parts: [{ type: 'text', text: answer }], status: 'done' });
    await app.repo.flush();
    await app.controller.selectThread(th.id);
    return { threadId: th.id, msgId: msg.id };
}, ANSWER);

const panel = (/** @type {any} */ h) => h.eval(() => window.LolChat.app.page.debug());

/** Open the page beside the chat and wait for its first run's error. */
const openBeside = async (/** @type {any} */ h) => {
    await h.waitFor(() => !!document.querySelector('.chat-page-beside'), { timeout: 10000 });
    await h.eval(() => /** @type {HTMLElement} */ (document.querySelector('.chat-page-beside')).click());
    return h.waitFor(() => {
        const d = window.LolChat.app.page.debug();
        return d && d.errors.length && d.lines ? d : null;
    }, { timeout: 20000 });
};

export default [
    {
        name: 'k30-page-error-names-its-block-and-line',
        async run(/** @type {any} */ h) {
            await seed(h);
            // The message's own Preview: the note says where.
            await h.waitFor(() => !!document.querySelector('.chat-page-preview'), { timeout: 10000 });
            await h.eval(() => {
                const fig = /** @type {HTMLElement} */ (document.querySelector('.chat-page-preview')).closest('figure');
                /** @type {HTMLElement} */ (fig.querySelector('[data-tab="preview"]')).click();
            });
            const inline = await h.waitFor(() => {
                const n = document.querySelector('.chat-page-note');
                return n && !n.hidden && /nope/.test(n.textContent || '') ? n.textContent : null;
            }, { timeout: 20000 });
            h.note(`inline: ${inline}`);
            h.assert(/in JavaScript, line 3: nope is not defined/.test(inline), `the Preview names the block and line: ${inline}`);

            const d = await openBeside(h);
            h.eq(d.blocks.map((/** @type {any} */ b) => b.name).join(','), 'HTML,CSS,JavaScript', 'one tab per block of the page');
            h.eq(d.errors[0].message, 'nope is not defined');
            h.eq(JSON.stringify(d.errors[0].at), JSON.stringify({ fence: 2, line: 3, col: 1 }), 'the third block, its line 3');
            const inMessage = await h.eval(() => {
                const fig = document.querySelector('.chat-page-preview').closest('figure');
                return /** @type {HTMLElement} */ (fig.querySelector('[data-tab="code"]')).getAttribute('aria-pressed');
            });
            h.eq(inMessage, 'true', 'the message\'s Preview went back to its code: one page runs at a time');
            const consoleText = await h.eval(() => document.querySelector('.chat-pagep-console').textContent);
            h.assert(/ready/.test(consoleText), `the console shows the page's console.log: ${consoleText}`);
            const fit = await h.eval(() => ({
                page: Number((/ready (\d+)/.exec(document.querySelector('.chat-pagep-console').textContent || '') || [])[1] || 0),
                box: Math.floor(document.querySelector('.chat-pagep-stage').clientWidth),
            }));
            h.assert(fit.page > 200 && Math.abs(fit.page - fit.box) <= 2, `the page is as wide as its box: ${JSON.stringify(fit)}`);
            const go = await h.eval(() => document.querySelector('.chat-pagep-goto').textContent);
            h.eq(go, 'JavaScript, line 3');

            // Show the HTML tab, then the error's button brings the JavaScript back with line 3 selected.
            await h.eval(() => /** @type {HTMLElement} */ (document.querySelectorAll('.chat-pagep-tab')[0]).click());
            await h.eval(() => /** @type {HTMLElement} */ (document.querySelector('.chat-pagep-goto')).click());
            const sel = await h.eval(() => {
                const area = /** @type {HTMLTextAreaElement} */ (document.activeElement);
                return { shown: window.LolChat.app.page.debug().shown, text: area.value.slice(area.selectionStart, area.selectionEnd) };
            });
            h.eq(sel.shown, 2, 'the JavaScript tab is shown');
            h.eq(sel.text, 'nope();', 'its line 3 is selected');
            const marked = await h.eval(() => {
                const ed = Array.from(document.querySelectorAll('.chat-pagep-editor')).find((e) => !(/** @type {HTMLElement} */ (e)).hidden);
                const row = ed && ed.querySelector('.comp-code-ln.is-error');
                return row ? row.textContent : null;
            });
            h.eq(marked, '3', 'the gutter marks line 3');
            await h.screenshot('k30-page-panel-error');
        },
    },
    {
        name: 'k30-page-edit-runs-and-is-kept',
        async run(/** @type {any} */ h) {
            const ids = await seed(h);
            const first = await openBeside(h);
            await h.eval(() => /** @type {HTMLElement} */ (document.querySelector('.chat-pagep-goto')).click());
            await h.input.type("console.log('fixed');");
            const after = await h.waitFor(() => {
                const d = window.LolChat.app.page.debug();
                return d && d.runs > 1 && !d.errors.length && /fixed/.test(document.querySelector('.chat-pagep-console').textContent || '') ? d : null;
            }, { timeout: 20000 });
            h.assert(after.runs > first.runs, 'the page ran again after the pause in typing');
            h.assert(/console\.log\('fixed'\);$/.test(after.edits['2']), `the edit is the person's: ${JSON.stringify(after.edits)}`);
            const kept = await h.waitFor((msgId, threadId) => (async () => {
                const app = window.LolChat.app;
                const stored = (await app.repo.getMessages(threadId)).find((/** @type {any} */ m) => m.id === msgId);
                const held = app.controller.current().path.find((/** @type {any} */ m) => m.id === msgId);
                const chip = document.querySelector('.chat-page-edited');
                const s = stored && stored.pageEdits && stored.pageEdits.blocks['2'];
                const v = held && held.pageEdits && held.pageEdits.blocks['2'];
                return s && v && chip && !(/** @type {HTMLElement} */ (chip)).hidden
                    ? { s, v, content: stored.content === held.content && /nope\(\);/.test(stored.content) } : null;
            })(), { timeout: 5000, args: [ids.msgId, ids.threadId] }).catch(async () => h.eval(async (msgId, threadId) => {
                const app = window.LolChat.app;
                const stored = (await app.repo.getMessages(threadId)).find((/** @type {any} */ m) => m.id === msgId);
                return { failed: true, stored: stored && stored.pageEdits };
            }, ids.msgId, ids.threadId));
            h.assert(kept && !kept.failed, `the edit is kept: ${JSON.stringify(kept)}`);
            h.assert(/fixed/.test(kept.s) && kept.s === kept.v, 'on the record and on the view\'s copy (a pin writes it back)');
            h.eq(kept.content, true, 'the answer\'s own text is unchanged');
            await h.screenshot('k30-page-panel-fixed');

            // The message's own Pin writes the message the view holds: the edit must survive it.
            await h.eval((msgId) => {
                const b = document.querySelector(`.chat-msg[data-id="${msgId}"] .chat-action[data-action="pin"]`);
                if (!b) throw new Error('no pin action on the answer');
                /** @type {HTMLElement} */ (b).click();
                return true;
            }, ids.msgId);
            const pinned = await h.waitFor((msgId, threadId) => (async () => {
                const stored = (await window.LolChat.app.repo.getMessages(threadId)).find((/** @type {any} */ m) => m.id === msgId);
                return stored && stored.pinned ? { edits: !!(stored.pageEdits && /fixed/.test(stored.pageEdits.blocks['2'] || '')) } : null;
            })(), { timeout: 5000, args: [ids.msgId, ids.threadId] });
            h.eq(pinned.edits, true, 'a pin after an edit keeps the edit');

            // Another thread and back: the panel shows the page with the person's version.
            await h.eval(async () => {
                const app = window.LolChat.app;
                const other = app.repo.createThread({ title: 'Other' });
                app.repo.appendMessage(other.id, { role: 'user', content: 'x', parts: [{ type: 'text', text: 'x' }], status: 'done' });
                await app.repo.flush();
                await app.controller.selectThread(other.id);
            });
            await h.eval((id) => window.LolChat.app.controller.selectThread(id), ids.threadId);
            const back = await h.waitFor(() => {
                const d = window.LolChat.app.page.debug();
                return d && d.target && d.edits['2'] && d.runs >= 1 ? d : null;
            }, { timeout: 15000 });
            h.assert(/fixed/.test(back.edits['2']), 'the edit came back with the thread');
            const chipBack = await h.waitFor(() => {
                const c = document.querySelector('.chat-page-edited');
                return c && !(/** @type {HTMLElement} */ (c)).hidden ? 'shown' : null;
            }, { timeout: 5000 });
            h.eq(chipBack, 'shown', 'the answer\'s block says "edited" when the thread is drawn again');

            // Back to the model's code (its confirm answered yes): the error is back, the edit gone everywhere.
            await h.eval(() => { window.LolChat.app.dialogs.confirm = async () => true; });
            await h.eval(() => /** @type {HTMLElement} */ (document.querySelector('.chat-pagep-reset')).click());
            const reset = await h.waitFor(() => {
                const d = window.LolChat.app.page.debug();
                return d && !Object.keys(d.edits).length && d.errors.length ? d : null;
            }, { timeout: 15000 });
            h.eq(reset.errors[0].message, 'nope is not defined', 'the model\'s code runs again');
            const gone = await h.eval(async (msgId, threadId) => {
                const stored = (await window.LolChat.app.repo.getMessages(threadId)).find((/** @type {any} */ m) => m.id === msgId);
                const chip = document.querySelector('.chat-page-edited');
                return { stored: !!(stored && stored.pageEdits), chip: chip ? (/** @type {HTMLElement} */ (chip)).hidden : null };
            }, ids.msgId, ids.threadId);
            h.eq(JSON.stringify(gone), JSON.stringify({ stored: false, chip: true }), 'nothing kept, the block no longer says edited');
        },
    },
];
