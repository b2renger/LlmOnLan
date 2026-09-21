// @ts-check
// P1-U4 in the real browser: what the STORE looks like from the outside — the thread list, the
// store banner, the delete dialog, and the boot paths where history is (or is not) on disk.
//
// p0-store proved the repo itself; these scenarios prove the UI over it: a reload really shows
// yesterday's chat, a reply that was cut off says so in both the list and the thread, the memory
// banners appear and clear, a migrated v1 history is browsable, and deleting a chat asks first.
//
// They run against whatever components happen to be landed: with the fakes in place (a unit run)
// or with the real controller/view (a landing). Where an assertion can only hold for the real
// module, the scenario says so in a note instead of quietly weakening.

const V1_KEY = 'lol.chat.threads.v1';

/** Seed the v1 history key exactly as v0.1.45 would have left it. */
const seedV1 = (/** @type {any} */ h, /** @type {any} */ payload) =>
    h.eval((key, text) => { localStorage.setItem(key, text); return localStorage.getItem(key).length; },
        V1_KEY, JSON.stringify(payload));

/** The rows of the sidebar, in screen order. */
const listRows = (/** @type {any} */ h) => h.eval(() => [...document.querySelectorAll('.chat-thread-row')].map((r) => ({
    id: r.getAttribute('data-id'),
    title: (r.querySelector('.chat-thread-title') || {}).textContent || '',
    active: !!r.querySelector('.chat-thread.active'),
    dot: !!r.querySelector('.chat-thread-dot:not(.hidden)'),
})));

/** Wait until the sidebar shows `n` rows. */
const waitRows = (/** @type {any} */ h, /** @type {number} */ n, timeout = 15000) => h.waitFor((want) => {
    const rows = [...document.querySelectorAll('.chat-thread-row')];
    return rows.length === want ? rows.map((r) => r.getAttribute('data-id')) : null;
}, { timeout, args: [n] });

/**
 * Click the row for `id` and wait until that thread is really the one on screen. Without the wait
 * the PREVIOUS thread's messages are still in the DOM and an assertion reads them by mistake.
 */
const openThread = async (/** @type {any} */ h, /** @type {string} */ id, /** @type {string} */ needle) => {
    await h.eval((threadId) => {
        const btn = document.querySelector(`.chat-thread[data-id="${threadId}"]`);
        if (!btn) throw new Error('openThread: no row for ' + threadId);
        btn.click();
        return true;
    }, id);
    await h.waitFor((threadId) => (window.LolChat.app.state.threadId === threadId ? true : null), { args: [id] });
    if (needle) {
        // The whole row, not just .chat-body: a 'local' message (the migrated busy note) puts its
        // text in .chat-msg-note and leaves the body empty (plan §3.5).
        await h.waitFor((text) => {
            const rows = [...document.querySelectorAll('.chat-msg')].map((m) => m.textContent || '');
            return rows.some((b) => b.includes(text)) ? rows.length : null;
        }, { args: [needle] });
    }
    return true;
};

/** Everything the thread view is showing, in order. */
const messages = (/** @type {any} */ h) => h.eval(() => [...document.querySelectorAll('.chat-msg')].map((m) => ({
    role: m.classList.contains('assistant') ? 'assistant' : 'user',
    status: m.getAttribute('data-status'),
    // §3.5: a USER row paints its text through PART_RENDERERS into `.chat-msg-parts` and leaves
    // `.chat-body` empty (it used to paint BOTH, i.e. every user message twice on screen).
    text: ((m.querySelector('.chat-body') || {}).textContent || '') || ((m.querySelector('.chat-msg-parts') || {}).textContent || ''),
    note: (m.querySelector('.chat-msg-note') || {}).textContent || '',
    full: m.textContent || '',
    strong: !!m.querySelector('.chat-body strong'),
    code: !!m.querySelector('.chat-body pre code, .chat-body code'),
})));

/** The store banner, or null. */
const banner = (/** @type {any} */ h) => h.eval(() => {
    const n = document.querySelector('.chat-banner-store');
    return n ? { text: n.textContent, mode: n.getAttribute('data-mode'), role: n.getAttribute('role') } : null;
});

/** Start a chat on a chosen model, in ONE evaluate (h.submit always uses the default). */
const submitOn = (/** @type {any} */ h, /** @type {string} */ model, /** @type {string} */ text) => h.eval(async (m, v) => {
    const nb = document.getElementById('chat-new');
    if (nb) nb.click();
    const app = window.LolChat.app;
    if (app.picker) await app.picker.set(m, { byUser: true });
    const sel = document.getElementById('chat-model');
    if (sel && sel.value !== m) sel.value = m;
    const input = document.getElementById('chat-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(input, v); else input.value = v;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('chat-form').requestSubmit();
    return sel ? sel.value : null;
}, model, text);

export default [
    {
        name: 'p1-persist',
        needsMock: true,
        timeoutMs: 90000,
        // The whole point of the phase: what you said yesterday is still there today.
        run: async (h) => {
            await h.submit('what GPU does the farm have?');
            const reply = await h.waitReply();
            h.assert(reply.text.trim().length > 0, 'the assistant answered');

            const live = await waitRows(h, 1);
            const beforeMode = await h.eval(() => window.LolChat.app.repo.mode);
            h.eq(beforeMode, 'idb', 'this scenario is meaningless unless the real database is open');

            await h.reload({ flags: {} });                     // same origin, same database
            const after = await waitRows(h, 1);
            h.eq(after, live, 'the same thread id came back out of IndexedDB');

            // Parity with v0.1.45 (chat.js:44 opened the newest chat at load) — and since v0.1.45's
            // "close means close" a relaunch is the EVERY-day experience, so a returning reader must
            // land in the conversation they were in, not on the empty state. main.mjs reopens
            // `ui:lastThreadId` (§3.7), falling back to the newest thread.
            const rowsNow = await h.waitFor(() => {
                const rows = [...document.querySelectorAll('.chat-thread-row')];
                if (!rows.length) return null;
                const out = rows.map((r) => ({
                    id: r.getAttribute('data-id'),
                    title: (r.querySelector('.chat-thread-title') || {}).textContent || '',
                    active: !!r.querySelector('.chat-thread.active'),
                }));
                return out[0].active ? out : null;
            }, { timeout: 15000 });
            h.assert(rowsNow[0].title.length > 0, 'the row carries a title');
            h.assert(rowsNow[0].active, 'a fresh boot reopens the last conversation');
            h.eq(await h.eval(() => window.LolChat.app.state.threadId), after[0], 'and it is the thread we were in');
            h.eq(await h.eval(() => window.LolChat.app.repo.kvGet('ui:lastThreadId', null)), after[0], 'ui:lastThreadId was written on selection');

            const msgs = await h.waitFor(() => {
                const m = [...document.querySelectorAll('.chat-msg')];
                return m.length >= 2 ? m.length : null;
            });
            h.eq(msgs, 2, 'the user turn and the reply both rendered');
            const rendered = await messages(h);
            h.eq(rendered.map((m) => m.role), ['user', 'assistant']);
            h.eq(rendered[0].text.trim(), 'what GPU does the farm have?');
            h.eq(rendered[1].text.trim(), reply.text.trim(), 'the stored reply is the streamed one');
            h.eq(rendered[1].status, 'done');
            h.note(`thread ${after[0]} reopened from IndexedDB with both messages`);
        },
    },

    {
        name: 'p1-crash-checkpoint',
        needsMock: true,
        timeoutMs: 120000,
        // The window died mid-reply. The checkpoint put the partial text on disk, boot recovery
        // turned 'streaming' into 'interrupted', and BOTH surfaces have to say so: the row carries
        // a dot, the message carries the status and the text it got as far as.
        run: async (h) => {
            const model = await submitOn(h, 'mock-slow', 'tell me a long story');
            h.eq(model, 'mock-slow', 'the picker took the slow model');

            // mock-slow: 3 s of silence, then 20 tok/s. Wait for real tokens, then let the repo's
            // 1 s checkpoint throttle fire a few times.
            const partial = await h.waitFor(() => {
                const b = document.querySelector('.chat-msg.assistant .chat-body');
                return b && b.textContent.trim().length > 8 ? b.textContent : null;
            }, { timeout: 30000 });
            await h.sleep(2200);

            const state = await h.eval(async () => {
                const app = window.LolChat.app;
                const repo = app.repo;
                const fakedController = !!(window.LolChat.failed && window.LolChat.failed.controller);
                const row = document.querySelector('.chat-msg.assistant');
                const id = row && row.getAttribute('data-id');
                const threadId = app.state.threadId;
                await repo.flush();
                const stored = (await repo.getMessages(threadId)).find((m) => m.id === id) || null;
                let patched = false;
                if (fakedController && stored && !(stored.content || '').length) {
                    // The development fake does not checkpoint (the real controller does, via
                    // net/run's onCheckpoint). Stand in for it so the STORE half is still tested.
                    stored.content = row.querySelector('.chat-body').textContent;
                    repo.checkpoint(stored);
                    await repo.flush();
                    patched = true;
                }
                const after = (await repo.getMessages(threadId)).find((m) => m.id === id) || null;
                return {
                    fakedController, patched, threadId, id,
                    storedLength: after ? (after.content || '').length : 0,
                    storedStatus: after ? after.status : null,
                };
            });
            h.assert(state.storedLength > 0, 'a partial reply must be on disk before the crash');
            h.eq(state.storedStatus, 'streaming', 'and it still claims to be streaming');
            if (state.fakedController) h.note(`controller is FAKED: the scenario checkpointed for it (${state.storedLength} chars)`);
            else h.assert(!state.patched, 'the real controller checkpoints a streaming reply itself');

            await h.reload({ flags: {} });                     // == the crash
            await h.eval(() => window.LolChat.migration);      // step 12: migrate + recoverInterrupted
            const rows = await waitRows(h, 1);
            h.eq(rows, [state.threadId]);
            const withDot = await h.waitFor(() => {
                const r = document.querySelector('.chat-thread-row');
                return r && r.querySelector('.chat-thread-dot:not(.hidden)') ? true : null;
            }, { timeout: 8000 });
            h.assert(withDot, 'the row of a cut-off chat carries the dot');

            await openThread(h, state.threadId, 'tok');
            const msgs = await h.waitFor(() => {
                const m = [...document.querySelectorAll('.chat-msg.assistant')];
                return m.length ? m[m.length - 1].getAttribute('data-status') : null;
            });
            h.eq(msgs, 'interrupted', 'a half-written reply is never left claiming to stream');
            const rendered = await messages(h);
            const body = rendered[rendered.length - 1].text.trim();
            h.assert(body.length > 0, 'the partial text survived');
            h.assert(partial.trim().startsWith(body.slice(0, 20)) || body.startsWith(partial.trim().slice(0, 20)),
                `the recovered text is the streamed prefix (got "${body.slice(0, 40)}…")`);
            h.note(`recovered ${body.length} chars of an interrupted mock-slow reply`);
        },
    },

    {
        name: 'p1-migrate-ui',
        needsMock: true,
        timeoutMs: 120000,
        // The upgrade a user actually sees: yesterday's v0.1.45 localStorage history is in the
        // sidebar, in the same order, and its messages open and render.
        run: async (h) => {
            // A 3-thread v1 history, newest first, written by the client this one replaces. The
            // ids carry the v1 `Date.now()` prefix the migration reads as createdAt.
            const seeded = await seedV1(h, [
                {
                    id: '1789000300000abcde',
                    title: 'Rig notes',
                    messages: [
                        { role: 'user', content: 'what GPU does the farm have?' },
                        { role: 'assistant', content: 'An **A6000 Pro**. Check it with `nvidia-smi`.', stats: '128 tok · 42.0 tok/s · first token 0.31s' },
                    ],
                },
                {
                    id: '1789000200000fghij',
                    title: 'Kitchen table',
                    messages: [
                        { role: 'user', content: 'suggest a dinner' },
                        { role: 'assistant', content: '⏳ The server is busy: loading gemma4:12b (42%). Try again in a moment.' },
                    ],
                },
                { id: '1789000100000klmno', title: '', messages: [{ role: 'user', content: 'hello' }] },
            ]);
            h.assert(seeded > 100, 'the v1 key really is in localStorage');

            await h.reload({ flags: {} });
            const migration = await h.eval(() => window.LolChat.migration);
            h.eq(migration.status, 'done');
            h.eq(migration.imported, 3);

            const ids = await waitRows(h, 3);
            const rows = await listRows(h);
            h.eq(rows.map((r) => r.title), ['Rig notes', 'Kitchen table', 'New chat'],
                'v1 order is preserved (newest first) and an empty title falls back');
            h.eq(rows.filter((r) => r.dot).length, 0, 'nothing was interrupted');

            // 1. the markdown reply
            await openThread(h, ids[0], 'A6000 Pro');
            const notes = await messages(h);
            h.eq(notes.map((m) => m.role), ['user', 'assistant']);
            h.assert(notes[1].text.includes('A6000 Pro'), 'the migrated reply is on screen');
            const realView = await h.eval(() => !(window.LolChat.failed && window.LolChat.failed.view));
            if (realView) {
                h.assert(notes[1].strong && notes[1].code, 'the real view renders the migrated text as markdown');
            } else {
                h.assert(notes[1].text.includes('**A6000 Pro**'), 'the fake view shows the raw markdown source');
                h.note('view is FAKED: markdown structure not asserted (render/thread-view.mjs is P1-U3)');
            }

            // 2. the busy note: v1 appended it locally, so it is not a farm answer
            await openThread(h, ids[1], 'server is busy');
            const busy = await h.eval(() => {
                const m = [...document.querySelectorAll('.chat-msg.assistant')];
                return m.length ? m[m.length - 1].getAttribute('data-status') : null;
            });
            h.eq(busy, 'local', 'the “server is busy” message migrated as a LOCAL note, not an answer');
            const busyMsgs = await messages(h);
            const last = busyMsgs[busyMsgs.length - 1];
            h.assert(/server is busy/.test(last.full), 'and it still reads as the busy note');
            if (realView) {
                h.eq(last.text.trim(), '', 'a local note is never rendered as an answer body');
                h.assert(/server is busy/.test(last.note), `the real view puts it in .chat-msg-note: ${JSON.stringify(last.note.slice(0, 40))}`);
            } else {
                h.note('view is FAKED: the note/body split is not asserted (render/thread-view.mjs is P1-U3)');
            }

            h.assert(await h.eval((k) => localStorage.getItem(k) !== null, V1_KEY), 'the v1 key is never removed');
            h.note('3 migrated threads listed in v1 order; markdown reply and busy note both open');
        },
    },

    {
        name: 'p1-late-idb-ui',
        needsMock: true,
        timeoutMs: 120000,
        // A slow disk: the banner says history is not saved YET, the chat keeps working, and when
        // the database attaches the banner goes away and what was typed is really on disk.
        run: async (h) => {
            await h.reload({ flags: { idbOpenDelayMs: 4500 } });
            const shown = await h.waitFor(() => {
                const n = document.querySelector('.chat-banner-store');
                return n ? { text: n.textContent, mode: n.getAttribute('data-mode'), role: n.getAttribute('role') } : null;
            }, { timeout: 12000 });
            h.eq(shown.mode, 'memory', 'the 3 s timeout put the store in memory');
            h.eq(shown.role, 'status');
            h.assert(/isn't being saved yet/.test(shown.text), `the banner says so plainly: ${JSON.stringify(shown.text.slice(0, 60))}`);

            await h.submit('typed while the database was still opening');
            const reply = await h.waitReply();
            h.assert(reply.text.trim().length > 0, 'the chat works during the memory window');
            const ids = await waitRows(h, 1);

            await h.waitFor(() => (document.querySelector('.chat-banner-store') === null ? true : null), { timeout: 12000 });
            h.eq(await h.eval(() => window.LolChat.app.repo.mode), 'idb', 'the database attached late');
            h.eq(await banner(h), null, 'and the banner cleared itself');

            await h.reload({ flags: {} });
            const after = await waitRows(h, 1);
            h.eq(after, ids, 'what was typed during the memory window was replayed and is still listed');
            await openThread(h, after[0], 'typed while the database was still opening');
            const msgs = await h.waitFor(() => {
                const m = [...document.querySelectorAll('.chat-msg')];
                return m.length >= 2 ? m.map((x) => x.classList.contains('assistant') ? 'assistant' : 'user') : null;
            });
            h.eq(msgs, ['user', 'assistant']);
            h.note('pending → memory (banner) → idb (banner cleared); the memory-window chat survived a reload');
        },
    },

    {
        name: 'p1-memory-final-ui',
        needsMock: true,
        timeoutMs: 90000,
        // No database at all. The banner is honest about it and the chat still works for today.
        // It is also the one boot where STORE_MODE fires BEFORE any feature installs (plan §2.6 I),
        // so a store banner that only subscribed would never appear.
        run: async (h) => {
            await h.reload({ flags: { forceMemoryStore: true } });
            const shown = await h.waitFor(() => {
                const n = document.querySelector('.chat-banner-store');
                return n ? { text: n.textContent, mode: n.getAttribute('data-mode'), role: n.getAttribute('role') } : null;
            }, { timeout: 8000 });
            h.eq(shown.mode, 'memory-final');
            h.eq(shown.role, 'alert');
            h.assert(/can't be saved/.test(shown.text), `the banner names the dead end: ${JSON.stringify(shown.text.slice(0, 60))}`);
            h.eq(await h.eval(() => window.LolChat.app.repo.mode), 'memory-final');

            await h.submit('does the chat still work with no database?');
            const reply = await h.waitReply();
            h.assert(reply.text.trim().length > 0, 'chatting still works');
            h.assert(/tok · .* tok\/s · first token /.test(reply.stats), `the stats line is the parity format: ${reply.stats}`);
            await waitRows(h, 1);

            const stillThere = await banner(h);
            h.eq(stillThere && stillThere.mode, 'memory-final', 'the banner stays for the whole session');
            h.eq(await h.eval(() => document.querySelectorAll('.chat-banner-store').length), 1, 'exactly one banner node');
            h.note('memory-final banner read from repo.mode at install time; the chat works anyway');
        },
    },

    {
        name: 'p1-sidebar-delete',
        needsMock: true,
        timeoutMs: 120000,
        // Deleting a chat is destructive and local: it asks first, it can be refused, and when it
        // is confirmed the chat is gone from the list AND from the database.
        run: async (h) => {
            await h.submit('first chat, about GPUs');
            await h.waitReply();
            await h.submit('second chat, about pasta');
            await h.waitReply();
            const ids = await waitRows(h, 2);
            const victim = ids[0];                              // the newest is first
            const survivor = ids[1];

            // 1. refused
            await h.eval((id) => {
                const x = document.querySelector(`.chat-thread-row[data-id="${id}"] .chat-thread-x`);
                if (!x) throw new Error('no delete button on the row');
                x.focus();
                x.click();
            }, victim);
            const dlg = await h.waitFor(() => {
                const d = document.querySelector('dialog.chat-dialog');
                if (!d || !d.open) return null;
                return {
                    title: (d.querySelector('.chat-dialog-title') || {}).textContent || '',
                    body: (d.querySelector('.chat-dialog-text') || {}).textContent || '',
                    ok: (d.querySelector('.chat-dialog-ok') || {}).textContent || '',
                    danger: !!d.querySelector('.chat-dialog-ok.chat-dialog-danger'),
                    focused: document.activeElement ? document.activeElement.className : '',
                };
            });
            h.assert(/second chat/.test(dlg.body), `the confirm names the chat it would delete: ${JSON.stringify(dlg.body)}`);
            h.assert(dlg.danger, 'a destructive confirm is marked as such');
            h.assert(/chat-dialog-cancel/.test(dlg.focused), 'a destructive dialog focuses Cancel, not Delete');

            await h.click('.chat-dialog-cancel');
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog') === null ? true : null));
            h.eq((await listRows(h)).length, 2, 'a refused confirm deletes nothing');
            const focusBack = await h.eval(() => (document.activeElement ? document.activeElement.className : ''));
            h.assert(/chat-thread-x/.test(focusBack), `focus went back to the × that opened it (got ${JSON.stringify(focusBack)})`);

            // 2. confirmed
            await h.eval((id) => document.querySelector(`.chat-thread-row[data-id="${id}"] .chat-thread-x`).click(), victim);
            await h.waitFor(() => (document.querySelector('.chat-dialog-ok') ? true : null));
            await h.click('.chat-dialog-ok');
            const left = await waitRows(h, 1);
            h.eq(left, [survivor], 'the chat is gone from the list');
            h.eq(await h.eval(() => (document.querySelector('dialog.chat-dialog') === null)), true, 'and the dialog closed');

            const selected = await h.eval(() => window.LolChat.app.state.threadId);
            h.eq(selected, survivor, 'the next chat took its place');
            const rowsNow = await listRows(h);
            h.assert(rowsNow[0].active, 'and its row is highlighted');

            await h.reload({ flags: {} });
            const after = await waitRows(h, 1);
            h.eq(after, [survivor], 'the deletion reached IndexedDB, not just the DOM');
            const gone = await h.eval((id) => window.LolChat.app.repo.getThread(id).then((x) => x === null), victim);
            h.assert(gone, 'the thread record itself is gone');
            h.note(`deleted ${victim}; cancel path, focus restore and the reload all checked`);
        },
    },
    {
        name: 'p1-delete-streaming',
        needsMock: true,
        timeoutMs: 120000,
        // REGRESSION (fix round 2): deleting the chat a reply is streaming into used to leave the
        // generation running — the farm kept generating (and kept the seat the seat gate gave this
        // client), the governor stayed busy so the composer refused every later send, and the last
        // checkpoint wrote the assistant row back into the thread that had just been deleted.
        run: async (h) => {
            await submitOn(h, 'mock-slow', 'take your time, I am about to delete this');
            await h.waitFor(() => (document.querySelector('.chat-msg[data-status="streaming"]') ? true : null), { timeout: 30000 });
            const victim = await h.eval(() => window.LolChat.app.state.threadId);

            await h.eval((id) => document.querySelector(`.chat-thread-row[data-id="${id}"] .chat-thread-x`).click(), victim);
            await h.waitFor(() => (document.querySelector('.chat-dialog-ok') ? true : null));
            await h.click('.chat-dialog-ok');

            // the generation must be over, not merely off screen
            const idle = await h.waitFor(() => {
                const app = window.LolChat.app;
                if (app.controller.isStreaming()) return null;
                if (app.gov && app.gov.state().foreground !== 'idle') return null;
                return { gov: app.gov ? app.gov.state().foreground : 'none', streaming: !!document.querySelector('.chat-msg[data-status="streaming"]') };
            }, { timeout: 30000 });
            h.eq(idle.gov, 'idle', 'the governor came back: the composer can send again');
            h.eq(idle.streaming, false, 'nothing is still painting');

            let posts = (await h.mock.log({ path: '/v1/chat/completions' })).filter((e) => e.method === 'POST');
            for (let i = 0; i < 30 && !(posts[0] && posts[0].closedEarly); i++) {
                await h.sleep(100);
                posts = (await h.mock.log({ path: '/v1/chat/completions' })).filter((e) => e.method === 'POST');
            }
            h.eq(posts.length, 1, 'exactly the one completion');
            h.eq(posts[0].closedEarly, true, 'the farm saw the client walk away, so the seat frees');

            // and nothing of the deleted chat survived in the store
            const left = await h.eval((id) => {
                const repo = window.LolChat.app.repo;
                const orphans = [];
                return Promise.resolve(repo.scanMessages((m) => { if (m.threadId === id) orphans.push(m.id); }))
                    .then(() => repo.getThread(id))
                    .then((th) => ({ thread: th, orphans: orphans.length }));
            }, victim);
            h.eq(left.thread, null, 'the thread record is gone');
            h.eq(left.orphans, 0, 'and no message was written back into it');

            // the app still works: a new chat sends and answers
            await h.submit('and now a fresh one');
            const reply = await h.waitReply();
            h.assert(/tok\/s/.test(reply.stats || ''), `the next reply finished normally: ${JSON.stringify(reply.stats)}`);
            h.note(`deleted ${victim} mid-stream: socket closed, governor idle, 0 orphan messages`);
        },
        allowConsoleErrors: [/Failed to load resource/, /net::ERR_(ABORTED|FAILED|CONNECTION_RESET)/],
    },
    {
        name: 'p1-dialogs',
        needsMock: false,
        timeoutMs: 90000,
        // The dialog surfaces the sidebar × does NOT exercise: prompt (P2 renames with it), the
        // Popover-API menu behind the ⌄ button, and the toast stack. Everything here is real
        // browser behaviour — the top layer, `popover="auto"`, focus restoration — which is why it
        // lives in the harness and not in the Node unit tests.
        run: async (h) => {
            const has = await h.eval(() => ({
                dialogs: !!window.LolChat.app.dialogs,
                faked: !!(window.LolChat.failed && window.LolChat.failed.dialogs),
                sidebar: !!window.LolChat.app.sidebar,
            }));
            h.assert(has.dialogs, 'the dialogs component is built');
            if (has.faked) { h.note('dialogs is FAKED — nothing here would be meaningful'); return; }

            // ---- prompt: OK returns the typed value --------------------------------------------
            await h.eval(() => {
                const btn = document.getElementById('chat-new');
                if (btn) btn.focus();                          // focus must come back here afterwards
                window.__p = window.LolChat.app.dialogs.prompt({ title: 'Rename chat', value: 'old name', placeholder: 'Title' });
                return true;
            });
            const open = await h.waitFor(() => {
                const d = document.querySelector('dialog.chat-dialog');
                if (!d || !d.open) return null;
                const input = d.querySelector('.chat-dialog-input');
                return {
                    modal: d.matches(':modal'),
                    title: (d.querySelector('.chat-dialog-title') || {}).textContent || '',
                    value: input ? input.value : null,
                    placeholder: input ? input.placeholder : null,
                    focusedInput: document.activeElement === input,
                    inBody: d.parentNode === document.body,
                };
            });
            h.eq(open.title, 'Rename chat');
            h.eq(open.value, 'old name', 'the prompt opens on the value it was given');
            h.eq(open.placeholder, 'Title');
            h.assert(open.modal, 'a prompt is a real modal <dialog> in the top layer');
            h.assert(open.focusedInput, 'and it focuses the input, not a button');
            h.assert(open.inBody, 'the dialog hangs off <body> so the message list cannot clip it');

            await h.type('.chat-dialog-input', 'a new name');
            await h.click('.chat-dialog-ok');
            const typed = await h.eval(() => window.__p);
            h.eq(typed, 'a new name', 'OK resolves with what was typed');
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog') === null ? true : null));
            h.eq(await h.eval(() => (document.activeElement ? document.activeElement.id : '')), 'chat-new',
                'focus went back to whatever had it before the dialog opened');

            // ---- prompt: cancelled resolves null ------------------------------------------------
            // Escape is the close-watcher path: it fires `cancel`, then closes with the returnValue
            // untouched. A synthetic keydown is untrusted, so the close watcher may ignore it
            // (checked below); close() with no argument is exactly the tail of that same path.
            await h.eval(() => { window.__p2 = window.LolChat.app.dialogs.prompt({ title: 'Rename chat', value: 'x' }); return true; });
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog[open]') ? true : null));
            await h.key('.chat-dialog-input', 'Escape');
            await h.sleep(250);
            const escClosed = await h.eval(() => document.querySelector('dialog.chat-dialog') === null);
            if (escClosed) h.note('a synthetic Escape DOES close the dialog on this Electron');
            else {
                h.note('a synthetic Escape is untrusted and never reaches the dialog close watcher — closing the way the UA would');
                await h.eval(() => { document.querySelector('dialog.chat-dialog').close(); return true; });
            }
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog') === null ? true : null));
            h.eq(await h.eval(() => window.__p2), null, 'a cancelled prompt resolves null, never an empty string');

            // ---- confirm: Cancel resolves false --------------------------------------------------
            await h.eval(() => { window.__c = window.LolChat.app.dialogs.confirm({ title: 'Sure?', body: 'really?', ok: 'Do it' }); return true; });
            await h.waitFor(() => (document.querySelector('.chat-dialog-cancel') ? true : null));
            await h.click('.chat-dialog-cancel');
            h.eq(await h.eval(() => window.__c), false, 'Cancel resolves false');
            await h.waitFor(() => (document.querySelector('dialog.chat-dialog') === null ? true : null));

            // ---- the ⌄ menu: a popover under the anchor ------------------------------------------
            if (!has.sidebar) { h.note('no sidebar component: the ⌄ menu half is skipped'); return; }
            const added = await h.eval(async () => {
                const app = window.LolChat.app;
                window.__ran = 0;
                app.registry.add(app.SLOTS.NEW_MENU, { id: 'harness.newMenu', label: 'Blank chat', run: () => { window.__ran += 1; } });
                await app.sidebar.render();
                const b = document.querySelector('.chat-new-menu');
                return b ? {
                    label: b.textContent,
                    haspopup: b.getAttribute('aria-haspopup'),
                    beside: b.parentNode === document.querySelector('.chat-side-head'),
                } : null;
            });
            h.assert(added, 'the ⌄ button appears once the NEW_MENU slot has an item');
            h.eq(added.haspopup, 'menu');
            h.assert(added.beside, 'and it sits beside #chat-new in the sidebar head');

            await h.click('.chat-new-menu');
            const pop = await h.waitFor(() => {
                const p = document.querySelector('.chat-popover');
                if (!p) return null;
                const anchor = document.querySelector('.chat-new-menu').getBoundingClientRect();
                const r = p.getBoundingClientRect();
                return {
                    popoverAttr: p.getAttribute('popover'),
                    open: p.matches(':popover-open'),
                    items: [...p.querySelectorAll('.chat-menu-item')].map((x) => x.textContent),
                    below: r.top >= anchor.bottom - 1,
                    inBody: p.parentNode === document.body,
                };
            });
            h.eq(pop.popoverAttr, 'auto', 'light dismiss belongs to the browser, not to us');
            h.assert(pop.open, 'the popover really is in the top layer');
            // P2-U4 gave the sidebar a built-in NEW_MENU item ("New ephemeral chat", order 10), so
            // the harness item is no longer alone in the menu — it sorts after it (no order = 500).
            h.assert(pop.items.includes('Blank chat'), `the harness item is in the menu: ${pop.items.join(' / ')}`);
            h.eq(pop.items[pop.items.length - 1], 'Blank chat');
            h.assert(pop.below, 'it opens under the button that owns it');
            h.assert(pop.inBody, 'and hangs off <body>, outside the scrolling panes');

            await h.click('.chat-menu-item[data-item="harness.newMenu"]');
            h.eq(await h.eval(() => window.__ran), 1, 'the item ran');
            await h.waitFor(() => (document.querySelector('.chat-popover') === null ? true : null));

            // light dismiss leaves nothing behind either
            await h.click('.chat-new-menu');
            await h.waitFor(() => (document.querySelector('.chat-popover') ? true : null));
            await h.eval(() => { document.querySelector('.chat-popover').hidePopover(); return true; });
            await h.waitFor(() => (document.querySelector('.chat-popover') === null ? true : null));
            h.eq(await h.eval(() => window.__ran), 1, 'dismissing it runs nothing');

            // ---- toasts live INSIDE #lolchat -----------------------------------------------------
            const toast = await h.eval(() => {
                const app = window.LolChat.app;
                window.__t = app.dialogs.toast('saved', { kind: 'success', ms: 600 });
                const n = document.querySelector('.chat-toast');
                return n ? {
                    text: n.textContent,
                    role: n.getAttribute('role'),
                    kind: n.className,
                    insideRoot: document.getElementById('lolchat').contains(n),
                } : null;
            });
            h.assert(toast, 'the toast is on screen');
            h.eq(toast.text, 'saved');
            h.eq(toast.role, 'status');
            h.assert(/chat-toast-success/.test(toast.kind), 'the kind reaches the class list');
            h.assert(toast.insideRoot, 'the toast stack is a local stack inside #lolchat (plan §4 P1-U4)');
            await h.waitFor(() => (document.querySelector('.chat-toasts') === null ? true : null), { timeout: 5000 });
            h.note('toast auto-dismissed and took its empty stack with it');

            const errToast = await h.eval(() => {
                const api = window.LolChat.app.dialogs.toast('broke', { kind: 'error', ms: 60000 });
                const n = document.querySelector('.chat-toast');
                const role = n.getAttribute('role');
                n.click();                                       // a click dismisses it early
                return { role, gone: document.querySelector('.chat-toast') === null, api: typeof api.close === 'function' };
            });
            h.eq(errToast.role, 'alert', 'an error toast is announced, not just shown');
            h.assert(errToast.gone, 'clicking a toast dismisses it');
            h.assert(errToast.api, 'the caller gets a close() handle');
            h.eq(await h.eval(() => document.querySelectorAll('dialog.chat-dialog, .chat-popover, .chat-toasts').length), 0,
                'no dialog, popover or toast node is left in the document');
        },
    },
];
