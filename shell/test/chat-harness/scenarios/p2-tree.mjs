// @ts-check
// P2-U3 in the real browser against the real mock farm: the conversation tree (regenerate, edit,
// fork, delete, branch switching), Continue with its restart fallback, the thread header's system
// prompt, drafts and the keyboard shortcuts.
//
// The unit tests prove the planners and the restart detector in Node. Only these scenarios can
// prove the parts that live in the DOM: that the actions thread-view renders are wired to the right
// call, that a branch switch survives a RELOAD (the head is persisted, not held in memory), that
// the inline editor replaces a row without breaking it, and that the second continue request really
// carries the extra user turn on the wire.
//
// Every scenario first asserts that the P2-U3 modules are REAL: while a unit has not landed,
// main.mjs substitutes core/fakes.mjs (or simply skips a feature), and a green run against a
// missing feature would mean nothing.

const COMPLETIONS = '/v1/chat/completions';

/** Network noise the farm's own error paths make in the console (an aborted stream, a 4xx body). */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

const KEYS = ['branching', 'continue', 'messageActions', 'threadHeader', 'drafts', 'shortcuts'];

/** Fail loudly when this unit's features were not installed. */
const requireReal = (/** @type {any} */ h, /** @type {string[]} */ keys = KEYS) =>
    h.eval((want) => {
        const failed = (window.LolChat && window.LolChat.failed) || {};
        const missing = want.filter((k) => failed[k]);
        if (missing.length) {
            throw new Error(`P2-U3 needs the REAL modules, but the loader reported: ${missing.map((k) => `${k} (${failed[k].error})`).join('; ')}`);
        }
        const app = window.LolChat.app;
        if (!app.branching) throw new Error('app.branching is missing — app/branching.mjs did not install');
        if (!app.continueReply) throw new Error('app.continueReply is missing — app/continue.mjs did not install');
        return true;
    }, keys);

/** Wait until the farm reached the page AND the picker filled itself from /v1/models. */
const waitForModels = (/** @type {any} */ h) => h.waitFor(() => {
    const select = document.getElementById('chat-model');
    return !!(window.__lolFarm && select && select.options.length > 1) || null;
});

const newChat = (/** @type {any} */ h) => h.eval(() => { document.getElementById('chat-new').click(); return true; });

/** Pick a model the way a user does, then let the picker settle (plan §2.6 X). */
const pickModel = async (/** @type {any} */ h, /** @type {string} */ id) => {
    await h.eval((want) => {
        const select = /** @type {HTMLSelectElement} */ (document.getElementById('chat-model'));
        select.value = want;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return select.value;
    }, id);
    await h.waitFor((want) => (document.getElementById('chat-model').value === want ? true : null), { args: [id] });
    // the pick is written to the thread record asynchronously; the send below must see it
    await h.waitFor((want) => window.LolChat.app.repo.getThread(window.LolChat.app.state.threadId)
        .then((th) => (th && th.model === want ? true : null)), { args: [id] });
};

/** Send INTO the current thread (h.submit always starts a new one — plan §2.6 P). */
const sendHere = (/** @type {any} */ h, /** @type {string} */ text) => h.eval((v) => {
    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('chat-input'));
    const form = /** @type {HTMLFormElement} */ (document.getElementById('chat-form'));
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(input, v); else input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
    return true;
}, text);

/** Every message row as the reader sees it. */
const rows = (/** @type {any} */ h) => h.eval(() => Array.prototype.map.call(document.querySelectorAll('.chat-msg'), (m) => ({
    id: m.getAttribute('data-id'),
    role: m.classList.contains('user') ? 'user' : 'assistant',
    status: m.getAttribute('data-status'),
    text: ((m.querySelector('.chat-body') || {}).textContent || '') + ((m.querySelector('.chat-msg-parts') || {}).textContent || ''),
    note: ((m.querySelector('.chat-msg-note') || {}).textContent || '').trim(),
    stats: ((m.querySelector('.chat-stats') || {}).textContent || '').trim(),
    branch: ((m.querySelector('.chat-branch-at') || {}).textContent || '').trim(),
    actions: Array.prototype.map.call(m.querySelectorAll('.chat-action'), (b) => b.getAttribute('data-action')),
})));

const lastAssistant = async (/** @type {any} */ h) => {
    const all = await rows(h);
    const assistants = all.filter((r) => r.role === 'assistant');
    return assistants[assistants.length - 1] || null;
};

/** Wait until `n` assistant rows have finished (a `.chat-stats` line is the "done" marker). */
const waitReplyN = (/** @type {any} */ h, /** @type {number} */ n, timeout = 30000) => h.waitFor((want) => {
    const done = Array.prototype.filter.call(document.querySelectorAll('.chat-msg.assistant'), (m) => {
        const s = m.querySelector('.chat-stats');
        return !!(s && s.textContent.trim());
    });
    return done.length >= want ? done.length : null;
}, { args: [n], timeout });

/** The controller has finished writing: the record in the store is final. */
const waitSettled = (/** @type {any} */ h, timeout = 30000) => h.waitFor(() => {
    const app = window.LolChat.app;
    if (app.controller.isStreaming()) return null;
    const list = document.querySelectorAll('.chat-msg.assistant');
    const row = list[list.length - 1];
    const stats = row && row.querySelector('.chat-stats');
    return stats && stats.textContent.trim() ? true : null;
}, { timeout });

const clickAction = (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ action) => h.eval((msgId, act) => {
    const btn = document.querySelector(`.chat-msg[data-id="${msgId}"] .chat-action[data-action="${act}"]`);
    if (!btn) throw new Error(`no "${act}" action on message ${msgId}`);
    btn.click();
    return true;
}, id, action);

/** dir: 0 = ◀ previous, 1 = ▶ next. */
const clickBranch = (/** @type {any} */ h, /** @type {string} */ id, /** @type {number} */ dir) => h.eval((msgId, which) => {
    const btns = document.querySelectorAll(`.chat-msg[data-id="${msgId}"] .chat-branch-btn`);
    const btn = btns[which];
    if (!btn) throw new Error(`no branch button ${which} on message ${msgId}`);
    btn.click();
    return true;
}, id, dir);

/** The stored record of the last message of the open path. */
const lastRecord = (/** @type {any} */ h) => h.eval(() => {
    const app = window.LolChat.app;
    return app.repo.getPath(app.state.threadId).then((path) => path[path.length - 1] || null);
});

/** `key: value` lines of a mock-echo answer. */
const echoField = (/** @type {string} */ content, /** @type {string} */ name) => {
    const hit = String(content || '').split('\n').find((l) => l.startsWith(`${name}:`));
    return hit ? hit.slice(name.length + 1).trim() : null;
};

const completions = async (/** @type {any} */ h) => (await h.mock.log({ path: COMPLETIONS })) || [];

export default [
    {
        name: 'p2-regenerate',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // A second answer to the same question, the ◀ n/m ▶ control, and — the part only a reload
        // can prove — that the branch you are reading is remembered on the thread record.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);
            await pickModel(h, 'mock-echo');
            await sendHere(h, 'how do I bevel an edge?');
            await waitReplyN(h, 1);

            const first = await lastAssistant(h);
            h.assert(first.actions.includes('regenerate'), 'a finished answer offers Regenerate');
            h.assert(first.branch === '', 'one answer has no branch control');

            await clickAction(h, first.id, 'regenerate');
            await h.waitFor((old) => {
                const list = document.querySelectorAll('.chat-msg.assistant');
                const row = list[list.length - 1];
                if (!row || row.getAttribute('data-id') === old) return null;
                const stats = row.querySelector('.chat-stats');
                return stats && stats.textContent.trim() ? row.getAttribute('data-id') : null;
            }, { args: [first.id], timeout: 30000 });

            const second = await lastAssistant(h);
            h.assert(second.id !== first.id, 'the new answer is a new message, not a rewrite');
            h.eq(second.branch, '2/2', 'the branch control says which version this is');
            h.eq((await rows(h)).length, 2, 'the other version is off the visible path');

            // ◀ back to the first answer
            await clickBranch(h, second.id, 0);
            await h.waitFor((want) => {
                const row = document.querySelector(`.chat-msg[data-id="${want}"]`);
                const at = row && row.querySelector('.chat-branch-at');
                return at && at.textContent.trim() === '1/2' ? true : null;
            }, { args: [first.id] });

            // …and a reload still shows THAT one
            await h.reload();
            await h.waitFor((want) => {
                const list = document.querySelectorAll('.chat-msg.assistant');
                const row = list[list.length - 1];
                if (!row || row.getAttribute('data-id') !== want) return null;
                const at = row.querySelector('.chat-branch-at');
                return at && at.textContent.trim() === '1/2' ? true : null;
            }, { args: [first.id], timeout: 20000 });
            h.note('the selected branch survived a reload');
        },
    },

    {
        name: 'p2-regenerate-with',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // "More creative" is a CALL-layer param, so it beats the thread's own temperature (§3.6.3).
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);
            await pickModel(h, 'mock-echo');
            await h.eval(() => {
                const app = window.LolChat.app;
                return app.repo.updateThread(app.state.threadId, { params: { temperature: 0.5 } }).then(() => true);
            });

            await sendHere(h, 'echo the request');
            await waitReplyN(h, 1);
            const before = await lastRecord(h);
            h.eq(echoField(before.content, 'params'), 'temperature=0.5', 'the thread params are what a plain send uses');

            const first = await lastAssistant(h);
            await clickAction(h, first.id, 'regenerate-with');
            await h.waitFor(() => (document.querySelector('.chat-popover .chat-menu-item[data-option="creative"]') ? true : null));
            const options = await h.eval(() => Array.prototype.map.call(
                document.querySelectorAll('.chat-popover .chat-menu-item'), (b) => b.getAttribute('data-option')));
            h.eq(JSON.stringify(options), JSON.stringify(['creative', 'precise']), 'the built-in REGENERATE_OPTIONS, in order');

            await h.click('.chat-popover .chat-menu-item[data-option="creative"]');
            await h.waitFor((old) => {
                const list = document.querySelectorAll('.chat-msg.assistant');
                const row = list[list.length - 1];
                if (!row || row.getAttribute('data-id') === old) return null;
                const stats = row.querySelector('.chat-stats');
                return stats && stats.textContent.trim() ? true : null;
            }, { args: [first.id], timeout: 30000 });

            const after = await lastRecord(h);
            h.eq(echoField(after.content, 'params'), 'temperature=1', 'More creative won over the thread');
            const body = await h.mock.lastBody();
            h.eq(body.temperature, 1, 'and that is what went on the wire');
        },
    },

    {
        name: 'p2-edit',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Editing a question branches the tree: the old wording and its answer stay behind the ◀.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);
            await pickModel(h, 'mock-echo');
            await sendHere(h, 'original question');
            await waitReplyN(h, 1);

            const all = await rows(h);
            const user = all.find((r) => r.role === 'user');
            h.assert(user.actions.includes('edit'), 'a message you sent offers Edit');

            await clickAction(h, user.id, 'edit');
            await h.waitFor(() => (document.querySelector('.chat-edit-input') ? true : null));
            const editing = await h.eval((id) => {
                const row = document.querySelector(`.chat-msg[data-id="${id}"]`);
                return {
                    editing: row.getAttribute('data-editing'),
                    hidden: getComputedStyle(row.querySelector('.chat-msg-parts')).display,
                    value: document.querySelector('.chat-edit-input').value,
                };
            }, user.id);
            h.eq(editing.editing, 'user', 'the row goes into edit mode');
            h.eq(editing.hidden, 'none', 'and what it used to show is hidden, not duplicated');
            h.eq(editing.value, 'original question', 'pre-filled with what you wrote');

            // Escape closes it and puts the row back exactly as it was
            await h.key('.chat-edit-input', 'Escape');
            await h.waitFor(() => (document.querySelector('.chat-edit-input') === null ? true : null));
            const restored = await h.eval((id) => {
                const row = document.querySelector(`.chat-msg[data-id="${id}"]`);
                return { editing: row.getAttribute('data-editing'), text: row.textContent };
            }, user.id);
            h.eq(restored.editing, null, 'the row is out of edit mode');
            h.assert(restored.text.indexOf('original question') >= 0, 'and shows its message again');

            await clickAction(h, user.id, 'edit');
            await h.waitFor(() => (document.querySelector('.chat-edit-input') ? true : null));
            await h.type('.chat-edit-input', 'edited question');
            await h.click('.chat-edit .btn-accent');

            await h.waitFor(() => {
                const users = document.querySelectorAll('.chat-msg.user');
                const last = users[users.length - 1];
                if (!last || last.textContent.indexOf('edited question') < 0) return null;
                const list = document.querySelectorAll('.chat-msg.assistant');
                const reply = list[list.length - 1];
                const stats = reply && reply.querySelector('.chat-stats');
                return stats && stats.textContent.trim() ? true : null;
            }, { timeout: 30000 });

            const after = await rows(h);
            h.eq(after.length, 2, 'the visible path is the NEW question and its answer');
            h.eq(after[0].branch, '2/2', 'the question carries the branch control');
            h.assert(after[0].text.indexOf('edited question') >= 0);
            h.eq(await h.eval(() => document.querySelector('.chat-edit') === null), true, 'the editor is gone');

            await clickBranch(h, after[0].id, 0);
            await h.waitFor((want) => {
                const row = document.querySelector(`.chat-msg[data-id="${want}"]`);
                const at = row && row.querySelector('.chat-branch-at');
                return at && at.textContent.trim() === '1/2' ? true : null;
            }, { args: [user.id] });
            const back = await rows(h);
            h.assert(back[0].text.indexOf('original question') >= 0, 'the original wording is intact');
            h.eq(back.length, 2, 'and so is the answer it got');

            // P2 review, major: NOTHING closed the editor when the row it lives on went away. The
            // half-typed text was dropped into a detached node with no warning, and `isEditing()`
            // — which trusted its own handle — stayed true for the rest of the session, which
            // permanently disabled the ArrowUp shortcut below.
            await clickAction(h, back[0].id, 'edit');
            await h.waitFor(() => (document.querySelector('.chat-edit-input') ? true : null));
            await h.type('.chat-edit-input', 'half-typed and abandoned');
            const home = await h.eval(() => window.LolChat.app.state.threadId);

            await newChat(h);
            h.eq(await h.eval(() => document.querySelector('.chat-edit-input') === null), true,
                'the editor left with the chat it belonged to');

            await h.eval((id) => window.LolChat.app.controller.selectThread(id).then(() => true), home);
            await h.waitFor(() => (document.querySelectorAll('.chat-msg.user').length ? true : null));
            h.eq(await h.eval(() => document.querySelector('.chat-edit-input') === null), true,
                'and coming back does not resurrect it');

            // …and the shortcut that asks isEditing() still fires, which is what was really broken.
            await h.key('#chat-input', 'ArrowUp');
            await h.waitFor(() => (document.querySelector('.chat-edit-input') ? true : null));
            h.eq(await h.eval(() => document.querySelector('.chat-edit-input').value), 'original question',
                'ArrowUp still edits the last message I sent');
            await h.key('.chat-edit-input', 'Escape');
            await h.waitFor(() => (document.querySelector('.chat-edit-input') === null ? true : null));
        },
    },

    {
        name: 'p2-continue',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // mock-length stops at 200 tokens with finish_reason 'length'; Continue grows the SAME
        // message, sending the half-written reply as the last turn.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);
            await pickModel(h, 'mock-length');
            await sendHere(h, 'count for me');
            await waitReplyN(h, 1);

            const before = await lastAssistant(h);
            h.assert(before.actions.includes('continue'), 'a length stop offers Continue');
            h.assert(before.text.indexOf('tok199') >= 0, 'the first 200 tokens are on screen');

            await clickAction(h, before.id, 'continue');
            await h.waitFor((id) => {
                const row = document.querySelector(`.chat-msg[data-id="${id}"]`);
                return row && row.textContent.indexOf('tok399') >= 0 ? true : null;
            }, { args: [before.id], timeout: 30000 });
            await waitSettled(h);

            const after = await lastAssistant(h);
            h.eq(after.id, before.id, 'the same message grew — no second bubble');
            h.eq((await rows(h)).length, 2, 'and no extra row anywhere');

            const body = await h.mock.lastBody();
            const last = body.messages[body.messages.length - 1];
            h.eq(last.role, 'assistant', 'the continue request ENDS with the half-written reply');
            h.assert(!JSON.stringify(body).includes('"reasoning"'), 'no reasoning field on the wire');

            const record = await lastRecord(h);
            const occurrences = String(record.content).split('tok0 ').length - 1;
            h.eq(occurrences, 1, 'the first 200 tokens are not repeated');
            h.assert(String(record.content).startsWith('tok0 '), 'the partial is kept byte for byte');
            h.assert(String(record.content).indexOf('tok200 ') > 0, 'and the continuation was appended');
            h.eq((await completions(h)).length, 2, 'one send, one continue');
        },
    },

    {
        name: 'p2-continue-fallback',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // mock-restart-on-prefill ignores an assistant prefill and starts over. The observer has to
        // catch that on the FIRST chunk, abort before anything is painted, and ask again with the
        // explicit user turn — remembering the verdict for that model.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);
            await pickModel(h, 'mock-restart-on-prefill');

            // Slow the stream right down so Stop lands mid-answer, deterministically.
            await h.mock.state({ streamRate: { tickMs: 60, perTick: 1 } });
            await sendHere(h, 'count for me');
            await h.waitFor(() => {
                const list = document.querySelectorAll('.chat-msg.assistant');
                const row = list[list.length - 1];
                return row && row.textContent.indexOf('tok3 ') >= 0 ? row.getAttribute('data-id') : null;
            }, { timeout: 30000 });
            await h.click('#chat-stop');
            await h.waitFor(() => {
                const list = document.querySelectorAll('.chat-msg.assistant');
                const row = list[list.length - 1];
                return row && row.getAttribute('data-status') === 'aborted' ? true : null;
            });
            await h.mock.state({ streamRate: null });

            const stopped = await lastAssistant(h);
            h.assert(stopped.actions.includes('continue'), 'a reply you stopped offers Continue');
            const partial = String((await lastRecord(h)).content);

            await clickAction(h, stopped.id, 'continue');
            await h.waitFor((id) => {
                const row = document.querySelector(`.chat-msg[data-id="${id}"]`);
                return row && row.textContent.indexOf('(continuing)') >= 0 ? true : null;
            }, { args: [stopped.id], timeout: 30000 });
            await waitSettled(h);

            const log = await completions(h);
            h.eq(log.length, 3, 'the send, the refused prefill, and the fallback');
            const second = log[1].body.messages[log[1].body.messages.length - 1];
            h.eq(second.role, 'assistant', 'attempt one was a plain prefill');
            const third = log[2].body.messages[log[2].body.messages.length - 1];
            h.eq(third.role, 'user', 'attempt two appends a user turn');
            h.assert(String(third.content).includes('Continue exactly where you stopped'), 'saying exactly that');
            h.eq(log[2].body.messages.filter((m) => m.role === 'assistant').length, 1,
                'the prefill is still there — the extra turn comes AFTER it');

            const record = await lastRecord(h);
            const content = String(record.content);
            h.assert(content.startsWith(partial), 'the partial was never rewound');
            h.eq(content.split('Hello!').length - 1, 1, 'the restart was never painted or stored');
            h.eq(content.split('tok0 ').length - 1, 1, 'nothing is duplicated');
            h.assert(content.indexOf('(continuing)') > 0, `the continuation was appended to the partial: ${content.slice(0, 80)}…`);

            const mode = await h.eval(() => window.LolChat.app.repo.kvGet('continueMode:mock-restart-on-prefill', null));
            h.eq(mode, 'userTurn', 'the verdict is remembered per model (kv continueMode:<underlying>)');

            const threadMessages = await h.eval(() => {
                const app = window.LolChat.app;
                return app.repo.getMessages(app.state.threadId).then((m) => m.length);
            });
            h.eq(threadMessages, 2, 'the continue prompt lives on the wire only');
        },
    },

    {
        name: 'p2-fork-delete',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);
            await pickModel(h, 'mock-echo');
            await sendHere(h, 'question one');
            await waitReplyN(h, 1);
            await sendHere(h, 'question two');
            await waitReplyN(h, 2);

            const before = await rows(h);
            h.eq(before.length, 4);
            const firstAnswer = before[1];
            const originalThread = await h.eval(() => window.LolChat.app.state.threadId);

            await clickAction(h, firstAnswer.id, 'fork');
            await h.waitFor((old) => (window.LolChat.app.state.threadId && window.LolChat.app.state.threadId !== old
                ? window.LolChat.app.state.threadId : null), { args: [originalThread] });
            await h.waitFor(() => (document.querySelectorAll('.chat-msg').length === 2 ? true : null));

            const forked = await rows(h);
            h.eq(forked.length, 2, 'the fork holds root → the message you forked at');
            h.assert(forked.every((r) => !before.some((b) => b.id === r.id)), 'with fresh ids');
            h.assert(forked[0].text.indexOf('question one') >= 0);
            const title = await h.eval(() => {
                const app = window.LolChat.app;
                return app.repo.getThread(app.state.threadId).then((th) => th.title);
            });
            h.assert(/\(fork\)$/.test(title), `the fork says so in its title: ${title}`);

            const original = await h.eval((id) => window.LolChat.app.repo.getMessages(id).then((m) => m.length), originalThread);
            h.eq(original, 4, 'the thread it came from is untouched');

            // …and delete the branch back off the fork
            await clickAction(h, forked[1].id, 'delete');
            await h.waitFor(() => (document.querySelector('.chat-dialog-ok') ? true : null));
            const dialog = await h.eval(() => ({
                danger: !!document.querySelector('.chat-dialog-ok.chat-dialog-danger'),
                title: (document.querySelector('.chat-dialog-title') || {}).textContent || '',
            }));
            h.assert(dialog.danger, 'deleting is a destructive dialog');
            await h.click('.chat-dialog-ok');

            await h.waitFor(() => (document.querySelectorAll('.chat-msg').length === 1 ? true : null));
            const left = await rows(h);
            h.eq(left.length, 1);
            const head = await h.eval(() => {
                const app = window.LolChat.app;
                return app.repo.getThread(app.state.threadId).then((th) => th.headId);
            });
            h.eq(head, left[0].id, 'the head was repaired onto what is left');
        },
    },

    {
        name: 'p2-drafts-shortcuts',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);

            // ---- drafts: what you were typing comes back with the chat ---------------------
            await newChat(h);
            const threadA = await h.eval(() => window.LolChat.app.state.threadId);
            await h.type('#chat-input', 'a sentence I never sent');
            await h.waitFor((id) => window.LolChat.app.repo.getThread(id)
                .then((th) => (th && th.draft === 'a sentence I never sent' ? true : null)), { args: [threadA], timeout: 10000 });

            await newChat(h);                                   // the button clears the composer
            h.eq(await h.eval(() => document.getElementById('chat-input').value), '', 'a new chat starts empty');
            await h.eval((id) => window.LolChat.app.controller.selectThread(id), threadA);
            await h.waitFor(() => (document.getElementById('chat-input').value === 'a sentence I never sent' ? true : null));
            h.note('the draft came back with the thread');

            // ---- Escape stops a running reply ---------------------------------------------
            await newChat(h);
            await pickModel(h, 'mock-slow');
            await sendHere(h, 'take your time');
            await h.waitFor(() => window.LolChat.app.controller.isStreaming() || null, { timeout: 20000 });
            await h.key('body', 'Escape');
            await h.waitFor(() => (window.LolChat.app.controller.isStreaming() ? null : true), { timeout: 20000 });
            const slow = (await completions(h)).filter((e) => e.model === 'mock-slow');
            h.eq(slow.length, 1);
            h.eq(slow[0].closedEarly, true, 'Escape closed the stream at the farm, not just on screen');

            // ---- Escape cancels a CANCEL_HANDLERS item when nothing streams ----------------
            // The real one is P2-U1's seat wait; this proves the wiring Escape → controller.stop()
            // → the first ACTIVE cancel handler, which is the contract that unit depends on.
            await h.eval(() => {
                window.__cancelled = 0;
                window.LolChat.app.registry.add(window.LolChat.app.SLOTS.CANCEL_HANDLERS, {
                    id: 'harness-wait', order: 10, active: () => true, cancel: () => { window.__cancelled += 1; },
                });
                return true;
            });
            await h.key('body', 'Escape');
            h.eq(await h.eval(() => window.__cancelled), 1, 'Escape reached the cancel handler');

            // ---- Mod+Shift+O is a new chat -------------------------------------------------
            const threadsBefore = await h.eval(() => window.LolChat.app.repo.listThreads().then((t) => t.length));
            await h.key('body', 'O', { ctrl: true, shift: true });
            await h.waitFor((want) => window.LolChat.app.repo.listThreads()
                .then((t) => (t.length === want + 1 ? true : null)), { args: [threadsBefore] });

            // ---- and nothing fires while the chat is hidden --------------------------------
            await h.eval(() => { document.getElementById('lolchat').classList.add('hidden'); return true; });
            await h.waitFor(() => (window.LolChat.app.state.visible === false ? true : null));
            await h.eval(() => { window.__cancelled = 0; return true; });
            await h.key('body', 'Escape');
            await h.key('body', 'O', { ctrl: true, shift: true });
            const after = await h.eval((want) => window.LolChat.app.repo.listThreads()
                .then((t) => ({ threads: t.length, cancelled: window.__cancelled })), threadsBefore);
            h.eq(after.cancelled, 0, 'a hidden chat does not eat Escape');
            h.eq(after.threads, threadsBefore + 1, 'nor Mod+Shift+O');
            await h.eval(() => { document.getElementById('lolchat').classList.remove('hidden'); return true; });
        },
    },

    {
        name: 'p2-shortcut-edit-and-branch',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // ArrowUp in an empty composer edits the last thing you sent; Alt+← / Alt+→ walk the
        // branches of the last reply.
        run: async (h) => {
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);
            await pickModel(h, 'mock-echo');
            await sendHere(h, 'first wording');
            await waitReplyN(h, 1);

            await h.key('#chat-input', 'ArrowUp');
            await h.waitFor(() => (document.querySelector('.chat-edit-input') ? true : null));
            h.eq(await h.eval(() => document.querySelector('.chat-edit-input').value), 'first wording',
                'ArrowUp opened the editor on the last message I sent');

            // Ctrl+Enter saves and sends (and the shortcut listener must NOT also see that key)
            await h.type('.chat-edit-input', 'second wording');
            await h.key('.chat-edit-input', 'Enter', { ctrl: true });
            await h.waitFor(() => {
                const users = document.querySelectorAll('.chat-msg.user');
                const last = users[users.length - 1];
                if (!last || last.textContent.indexOf('second wording') < 0) return null;
                const at = last.querySelector('.chat-branch-at');
                return at && at.textContent.trim() === '2/2' ? true : null;
            }, { timeout: 30000 });
            await waitReplyN(h, 1);
            await waitSettled(h);
            h.eq(await h.eval(() => document.querySelector('.chat-edit-input') === null), true, 'the editor closed itself');

            // typing in the composer disarms it
            await h.type('#chat-input', 'half a thought');
            await h.key('#chat-input', 'ArrowUp');
            h.eq(await h.eval(() => document.querySelector('.chat-edit-input') === null), true,
                'ArrowUp in a composer with text is just a caret move');
            await h.type('#chat-input', '');

            // two answers, then walk them with Alt+←
            const first = await lastAssistant(h);
            await clickAction(h, first.id, 'regenerate');
            await h.waitFor((old) => {
                const list = document.querySelectorAll('.chat-msg.assistant');
                const row = list[list.length - 1];
                if (!row || row.getAttribute('data-id') === old) return null;
                const stats = row.querySelector('.chat-stats');
                return stats && stats.textContent.trim() ? true : null;
            }, { args: [first.id], timeout: 30000 });

            await h.key('body', 'ArrowLeft', { alt: true });
            await h.waitFor((want) => {
                const list = document.querySelectorAll('.chat-msg.assistant');
                const row = list[list.length - 1];
                return row && row.getAttribute('data-id') === want ? true : null;
            }, { args: [first.id] });
            await h.key('body', 'ArrowRight', { alt: true });
            await h.waitFor((want) => {
                const list = document.querySelectorAll('.chat-msg.assistant');
                const row = list[list.length - 1];
                return row && row.getAttribute('data-id') !== want ? true : null;
            }, { args: [first.id] });
            h.note('Alt+← / Alt+→ walk the branches of the last reply');
        },
    },

    {
        name: 'p2-system-prompt',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The thread header's system prompt is the FIRST system message, byte for byte (§3.6.3).
        run: async (h) => {
            const OVERRIDE = 'You are a Blender assistant. Answer in French.';
            await requireReal(h);
            await waitForModels(h);
            await newChat(h);
            await pickModel(h, 'mock-echo');

            await h.waitFor(() => (document.querySelector('.chat-thread-header [data-system-prompt]') ? true : null));
            h.eq(await h.eval(() => document.querySelector('[data-system-prompt]').getAttribute('data-system-prompt')), 'off');
            await h.click('[data-system-prompt]');
            await h.waitFor(() => (document.querySelector('.chat-system-input') ? true : null));
            await h.type('.chat-system-input', OVERRIDE);
            await h.click('.chat-system-row .btn-accent');
            await h.waitFor(() => (document.querySelector('[data-system-prompt="on"]') ? true : null));

            const stored = await h.eval(() => {
                const app = window.LolChat.app;
                return app.repo.getThread(app.state.threadId).then((th) => th.systemOverride);
            });
            h.eq(stored, OVERRIDE, 'saved on the thread record');

            await sendHere(h, 'echo the request');
            await waitReplyN(h, 1);
            const record = await lastRecord(h);
            h.eq(echoField(record.content, 'systemText'), JSON.stringify(OVERRIDE),
                'the override IS the system message the farm received');

            // renaming the thread through the header
            await h.click('.chat-header-title');
            await h.waitFor(() => (document.querySelector('.chat-dialog-input') ? true : null));
            await h.type('.chat-dialog-input', 'My bevel notes');
            await h.click('.chat-dialog-ok');
            await h.waitFor(() => {
                const el = document.querySelector('.chat-header-title');
                return el && el.textContent === 'My bevel notes' ? true : null;
            });
            const renamed = await h.eval(() => {
                const app = window.LolChat.app;
                return app.repo.getThread(app.state.threadId).then((th) => ({ title: th.title, source: th.titleSource }));
            });
            h.eq(renamed.title, 'My bevel notes');
            h.eq(renamed.source, 'user', 'a name you chose is never overwritten by the auto title');
        },
    },
];
