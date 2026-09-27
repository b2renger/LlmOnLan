// @ts-check
import { readFileSync } from 'node:fs';

// P2-U4 in the real browser: the library. Search over a real IndexedDB, export and import through
// the real file paths, ephemeral chats that really are not written down, groups/pin/rename that
// survive a reload, and the "remove the old v1 copy" button that refuses to throw away history it
// has not brought over yet.
//
// Two things these deliberately do NOT do:
//   - click the Import button. It opens a NATIVE file chooser, which in a hidden window would hang
//     the run. The scenario imports the same module the button uses and calls importFromText() —
//     the whole write half (parse → one runTx → THREADS_CHANGED → select), only without the picker.
//   - assume a download lands. Whether a programmatic `<a download>` reaches Electron's
//     will-download is an environment fact, not a contract; the export scenario records what
//     actually happened in `notes` and falls back to the same text the download would have carried.

const V1_KEY = 'lol.chat.threads.v1';

/** Seed the v1 history key exactly as v0.1.45 would have left it. */
const seedV1 = (/** @type {any} */ h, /** @type {any} */ payload) =>
    h.eval((key, text) => { localStorage.setItem(key, text); return localStorage.getItem(key).length; },
        V1_KEY, JSON.stringify(payload));

/** The rows of the sidebar, in screen order, with their group heading. */
const listRows = (/** @type {any} */ h) => h.eval(() => {
    const out = [];
    let group = null;
    for (const node of document.querySelectorAll('#chat-threads > *')) {
        if (node.classList.contains('chat-thread-group')) { group = node.textContent; continue; }
        if (!node.classList.contains('chat-thread-row')) continue;
        out.push({
            id: node.getAttribute('data-id'),
            msg: node.getAttribute('data-msg'),
            group,
            title: (node.querySelector('.chat-thread-title') || {}).textContent || '',
            snippet: (node.querySelector('.chat-result-snippet') || {}).textContent || '',
            ephemeral: node.classList.contains('ephemeral'),
            eye: !!node.querySelector('.chat-thread-eye:not(.hidden)'),
        });
    }
    return out;
});

/** Wait until the sidebar shows exactly `n` rows. */
const waitRows = (/** @type {any} */ h, /** @type {number} */ n, timeout = 15000) => h.waitFor((want) => {
    const rows = [...document.querySelectorAll('.chat-thread-row')];
    return rows.length === want ? rows.map((r) => r.getAttribute('data-id')) : null;
}, { timeout, args: [n] });

/** Seed threads + messages straight into the repo (no farm traffic, no seats taken). */
const seedThreads = (/** @type {any} */ h, /** @type {any[]} */ spec) => h.eval(async (rows) => {
    const app = window.LolChat.app;
    const made = [];
    for (const spec of rows) {
        const th = app.repo.createThread({ title: spec.title, ephemeral: !!spec.ephemeral });
        const ids = [];
        for (const m of spec.messages || []) {
            const msg = app.repo.appendMessage(th.id, {
                role: m.role || 'user', content: m.text, parts: [{ type: 'text', text: m.text }], status: 'done',
            });
            ids.push(msg.id);
        }
        if (spec.updatedAt) await app.repo.updateThread(th.id, { updatedAt: spec.updatedAt });
        if (spec.pinned) await app.repo.updateThread(th.id, { pinned: true });
        made.push({ id: th.id, messages: ids });
    }
    await app.repo.flush();
    await app.sidebar.render();
    return made;
}, spec);

/** Type into the search box and wait out the 150 ms debounce. */
const typeSearch = async (/** @type {any} */ h, /** @type {string} */ text) => {
    await h.eval((value) => {
        const input = document.querySelector('.chat-search-input');
        if (!input) throw new Error('no search box in els.sideTools');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(input, value); else input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }, text);
};

/**
 * Open the settings popover and wait for it. It RETRIES: the popover is light-dismissed by the
 * modal confirm it opens, and for one task after that the node is hidden but still in the document,
 * so a click that lands in that window can be read as "close it" instead of "open it".
 */
const openSettings = async (/** @type {any} */ h) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const showing = await h.eval(() => {
            const box = document.querySelector('.chat-settings');
            if (!document.querySelector('.chat-settings-gear')) throw new Error('no settings gear in els.sideFoot');
            return !!(box && box.isConnected && (!box.hasAttribute('popover') || box.matches(':popover-open')));
        });
        if (showing) return true;
        await h.eval(() => { document.querySelector('.chat-settings-gear').click(); return true; });
        const opened = await h.waitFor(() => (document.querySelector('.chat-settings') ? true : null), { timeout: 2000 })
            .then(() => true, () => false);
        if (opened) return true;
    }
    throw new Error('the settings popover would not open');
};

/** Open the … menu of a row and click one of its items. */
const rowMenu = async (/** @type {any} */ h, /** @type {string} */ threadId, /** @type {string} */ item) => {
    await h.eval((id) => {
        const row = document.querySelector(`.chat-thread-row[data-id="${id}"]`);
        if (!row) throw new Error('no row for ' + id);
        row.querySelector('.chat-thread-more').click();
        return true;
    }, threadId);
    await h.waitFor(() => (document.querySelector('.chat-popover .chat-menu-item') ? true : null));
    if (!item) return h.eval(() => [...document.querySelectorAll('.chat-popover .chat-menu-item')].map((b) => b.getAttribute('data-item')));
    return h.eval((want) => {
        const btn = [...document.querySelectorAll('.chat-popover .chat-menu-item')].find((b) => b.getAttribute('data-item') === want);
        if (!btn) throw new Error('no menu item ' + want);
        btn.click();
        return true;
    }, item);
};

/** Answer the modal confirm that is (or is about to be) on screen. */
const answerDialog = async (/** @type {any} */ h, /** @type {boolean} */ ok) => {
    await h.waitFor(() => (document.querySelector('dialog.chat-dialog') ? true : null));
    await h.eval((yes) => {
        const dlg = document.querySelector('dialog.chat-dialog');
        dlg.querySelector(yes ? '.chat-dialog-ok' : '.chat-dialog-cancel').click();
        return true;
    }, ok);
    // The dialog's own `close` event is what removes the node, and it is a queued task: anything
    // clicked before it lands is clicked THROUGH a modal that still owns the top layer.
    return h.waitFor(() => (document.querySelector('dialog.chat-dialog') ? null : true), { timeout: 5000 });
};

/** Click "remove the old v1 copy", reopening settings first: a modal dismisses the popover. */
const clickRemoveV1 = async (/** @type {any} */ h) => {
    await openSettings(h);
    await h.waitFor(() => {
        const btn = document.querySelector('.chat-settings-removev1');
        return btn && btn.getAttribute('data-state') !== 'checking' ? btn.getAttribute('data-state') : null;
    });
    return h.eval(() => { document.querySelector('.chat-settings-removev1').click(); return true; });
};

/** Every thread in the store, with the text of its messages — the shape a round trip must preserve. */
const storeDump = (/** @type {any} */ h) => h.eval(async () => {
    const repo = window.LolChat.app.repo;
    const out = [];
    for (const th of await repo.listThreads()) {
        const msgs = await repo.getMessages(th.id);
        out.push({
            id: th.id,
            title: th.title,
            pinned: !!th.pinned,
            imported: !!th.imported,
            texts: msgs.map((m) => m.content).sort(),
        });
    }
    return out.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : (a.id < b.id ? -1 : 1)));
});

export default [
    {
        name: 'p2-search',
        // 30 conversations, one of which says the word in French, with accents. Finding it from an
        // ASCII keyboard is the whole point of fold().
        run: async (h) => {
            const spec = [];
            for (let i = 0; i < 29; i += 1) {
                spec.push({ title: `Chat ${i}`, messages: [{ text: `nothing to see here, number ${i}` }] });
            }
            spec.push({
                title: 'Monument',
                messages: [
                    { text: 'de quoi parle-t-on ?' },
                    { role: 'assistant', text: 'Le projet dit de l’Éléphant de la Bastille est resté inachevé.' },
                ],
            });
            const made = await seedThreads(h, spec);
            await waitRows(h, 30);
            const needle = made[made.length - 1];

            await typeSearch(h, 'elephant');
            const rows = await h.waitFor(() => {
                const list = [...document.querySelectorAll('.chat-thread-row')];
                return list.length === 1 ? list[0].getAttribute('data-id') : null;
            });
            h.eq(rows, needle.id, 'the one accented chat is the one result');

            const result = (await listRows(h))[0];
            h.assert(result.snippet.includes('Éléphant'), `the result carries a snippet of the message: ${result.snippet}`);
            h.eq(result.msg, needle.messages[1], 'and names the message it was found in');

            // Clicking it opens the chat and flashes that message.
            await h.eval(() => { document.querySelector('.chat-result .chat-thread').click(); return true; });
            await h.waitFor((id) => (window.LolChat.app.state.threadId === id ? true : null), { args: [needle.id] });
            const flashed = await h.waitFor((id) => {
                const row = document.querySelector(`.chat-msg[data-id="${id}"]`);
                return row && row.classList.contains('chat-flash') ? true : null;
            }, { args: [needle.messages[1]], timeout: 5000 });
            h.assert(flashed, 'the matching message flashed');

            // Clearing the box brings the whole library back, grouped.
            await h.eval(() => { document.querySelector('.chat-search-clear').click(); return true; });
            await waitRows(h, 30);
            const all = await listRows(h);
            h.assert(all.every((r) => r.group), 'every row sits under a group heading');
            h.note(`30 chats, first group "${all[0].group}"`);
        },
    },

    {
        name: 'p2-export-import',
        timeoutMs: 90000,
        run: async (h) => {
            const made = await seedThreads(h, [
                { title: 'Rig notes', messages: [{ text: 'how do I mirror weights?' }, { role: 'assistant', text: 'Use the mirror modifier.' }] },
                { title: 'Éléphant', messages: [{ text: 'parle-moi de l’Éléphant' }] },
            ]);
            await waitRows(h, 2);
            const before = await storeDump(h);

            // Export through the real button in the real settings popover.
            await openSettings(h);
            await h.eval(() => { document.querySelector('.chat-settings-export').click(); return true; });

            let text = null;
            let how = 'download';
            let got = h.downloads();
            for (let i = 0; i < 20 && !got.length; i += 1) {
                await new Promise((r) => setTimeout(r, 250));
                got = h.downloads();
            }
            if (got.length) {
                text = readFileSync(got[0].path, 'utf8');
                h.note(`export reached the filesystem: ${got[0].name} (${got[0].bytes} bytes, ${got[0].state})`);
            } else {
                // No will-download in this environment: build exactly what the button built, so the
                // round trip is still a real one. Recorded, per plan §4 P2-U4.
                how = 'in-page';
                text = await h.eval(async () => {
                    const mod = await import('../../renderer/chat/app/transfer-format.mjs');
                    const app = window.LolChat.app;
                    const threads = await app.repo.listThreads();
                    const messages = [];
                    for (const th of threads) messages.push(...await app.repo.getMessages(th.id));
                    return JSON.stringify(mod.exportThreads({ threads, messages, attachments: [] }), null, 2);
                });
                h.note('no will-download fired for the object-URL anchor; the export text was taken from the same module the button uses');
            }
            h.assert(text && text.length > 100, 'the export has content');
            const parsed = JSON.parse(text);
            h.eq(parsed.lolchat, 1, 'the file says which format it is');
            h.eq(parsed.threads.length, 2, 'both chats are in it');
            h.note(`export path: ${how}`);

            // Import it back. The button itself opens a native picker, so the scenario calls the
            // module the button calls.
            const result = await h.eval(async (payload) => {
                const mod = await import('../../renderer/chat/ui/transfer.mjs');
                return mod.importFromText(window.LolChat.app, payload, { select: true });
            }, text);
            h.eq(result.threads, 2, 'two chats were imported');
            h.eq(result.errors.length, 0, 'with no complaints');

            await waitRows(h, 4);
            const after = await storeDump(h);
            h.eq(after.length, 4, 'the originals and the copies');
            for (const original of before) {
                const copies = after.filter((x) => x.title === original.title);
                h.eq(copies.length, 2, `two of "${original.title}"`);
                h.eq(copies[0].texts.join('|'), copies[1].texts.join('|'), 'with identical content');
                h.assert(copies[0].id !== copies[1].id, 'and different ids');
                h.assert(copies.some((c) => c.imported), 'the copy is flagged as imported');
                h.assert(copies.some((c) => !c.imported), 'the original is not');
            }

            // Both survive a reload: the import really went into IndexedDB.
            h.eq(await h.eval(() => window.LolChat.app.repo.mode), 'idb', 'this only means something against the real database');
            await h.reload({ flags: {} });
            await waitRows(h, 4);
            const reloaded = await storeDump(h);
            h.eq(reloaded.map((r) => r.title + ':' + r.texts.join('|')), after.map((r) => r.title + ':' + r.texts.join('|')),
                'the same four chats, same content, after a reload');
        },
    },

    {
        name: 'p2-ephemeral',
        needsMock: true,
        timeoutMs: 90000,
        run: async (h) => {
            await seedThreads(h, [{ title: 'kept', messages: [{ text: 'this one is saved' }] }]);
            await waitRows(h, 1);

            // Start the ephemeral chat through the ⌄ menu, exactly as a person would.
            await h.eval(() => { document.querySelector('.chat-new-menu').click(); return true; });
            await h.waitFor(() => (document.querySelector('.chat-popover .chat-menu-item[data-item="ephemeral"]') ? true : null));
            await h.eval(() => { document.querySelector('.chat-popover .chat-menu-item[data-item="ephemeral"]').click(); return true; });
            const ghostId = await h.waitFor(() => window.LolChat.app.state.threadId || null);

            const marked = await h.waitFor((id) => {
                const row = document.querySelector(`.chat-thread-row[data-id="${id}"]`);
                return row && row.classList.contains('ephemeral') ? !!row.querySelector('.chat-thread-eye:not(.hidden)') : null;
            }, { args: [ghostId] });
            h.assert(marked, 'the ephemeral row carries the eye-off marker');

            // Send INTO it (h.submit would click #chat-new and start a saved chat instead).
            await h.eval(() => {
                const input = document.getElementById('chat-input');
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
                if (setter && setter.set) setter.set.call(input, 'say something forgettable'); else input.value = 'say something forgettable';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.getElementById('chat-form').requestSubmit();
                return true;
            });
            const reply = await h.waitReply();
            h.assert(reply.text.trim().length > 0, 'the ephemeral chat really did get a reply');
            h.eq(await h.eval(() => window.LolChat.app.state.threadId), ghostId, 'and it stayed in the same chat');

            // Nothing about it was ever handed to the persistent backend.
            const persistent = await h.eval(() => window.LolChat.app.repo.debug.persistentIds());
            h.assert(!persistent.includes(ghostId), 'the ephemeral chat never reached the persistent store');
            h.note(`persistentIds after the ephemeral reply: ${persistent.length}`);

            await h.eval(() => window.LolChat.app.repo.flush());
            await h.reload({ flags: {} });
            const rows = await waitRows(h, 1);
            h.assert(!rows.includes(ghostId), 'and it is gone after a reload');
            const dump = await storeDump(h);
            h.eq(dump.map((d) => d.title), ['kept'], 'only the saved chat came back');
        },
    },

    {
        // P2 review, major: "Export all chats" started from repo.listThreads(), which MERGES the
        // ephemeral backend — so one click wrote the sensitive one-off to a file on disk, and
        // re-importing it turned it into a permanent chat (parseImport forces ephemeral:false).
        // A temporary chat is the one the reader asked never to be written down.
        name: 'p2-export-skips-ephemeral',
        needsMock: true,
        timeoutMs: 60000,
        run: async (h) => {
            await seedThreads(h, [{ title: 'kept', messages: [{ text: 'this one is saved' }] }]);
            await waitRows(h, 1);

            // A temporary chat, started the way a person starts one (the ⌄ menu).
            await h.eval(() => { document.querySelector('.chat-new-menu').click(); return true; });
            await h.waitFor(() => (document.querySelector('.chat-popover .chat-menu-item[data-item="ephemeral"]') ? true : null));
            await h.eval(() => { document.querySelector('.chat-popover .chat-menu-item[data-item="ephemeral"]').click(); return true; });
            const ghostId = await h.waitFor(() => window.LolChat.app.state.threadId || null);
            await h.eval(() => {
                const input = document.getElementById('chat-input');
                const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
                if (setter && setter.set) setter.set.call(input, 'my bank password is hunter2'); else input.value = 'my bank password is hunter2';
                input.dispatchEvent(new Event('input', { bubbles: true }));
                document.getElementById('chat-form').requestSubmit();
                return true;
            });
            await h.waitReply();

            // Exactly what the Export all button would write — from the module the button calls.
            const out = await h.eval(async () => {
                const mod = await import('../../renderer/chat/ui/transfer.mjs');
                const got = await mod.collectExportAll(window.LolChat.app);
                return { skipped: got.skipped, titles: got.doc.threads.map((t) => t.title), text: JSON.stringify(got.doc) };
            });
            h.note(`export all: ${JSON.stringify(out.titles)} (skipped ${out.skipped})`);
            h.eq(out.skipped, 1, 'the temporary chat was left out, and counted');
            h.eq(out.titles.includes('kept'), true, 'the saved chat is in the file');
            h.eq(out.titles.length, 1, 'and it is the only one');
            h.eq(out.text.indexOf('hunter2'), -1, 'nothing the reader typed in the temporary chat reached the file');

            // The per-thread … export is still allowed to export one: that is an explicit choice.
            const one = await h.eval(async (id) => {
                const mod = await import('../../renderer/chat/app/transfer-format.mjs');
                const app = window.LolChat.app;
                const th = await app.repo.getThread(id);
                return !!(th && th.ephemeral) && !!mod.exportThreads({ threads: [th], messages: [] }).threads.length;
            }, ghostId);
            h.eq(one, true, 'the format itself never refuses a named chat');
        },
    },

    {
        name: 'p2-groups-pin-rename',
        timeoutMs: 60000,
        run: async (h) => {
            const now = Date.now();
            const made = await seedThreads(h, [
                { title: 'this morning', messages: [{ text: 'today' }] },
                { title: 'last week', messages: [{ text: 'a while ago' }], updatedAt: now - 4 * 86400000 },
            ]);
            await waitRows(h, 2);
            const start = await listRows(h);
            h.eq(start.map((r) => r.title), ['this morning', 'last week'], 'newest first');
            h.assert(start[0].group !== start[1].group, `two date groups, not one: ${start.map((r) => r.group).join(' / ')}`);
            const oldGroup = start[1].group;

            // Pin the older one: it jumps to the top, under the Pinned heading.
            await rowMenu(h, made[1].id, 'pin');
            await h.waitFor((id) => {
                const first = document.querySelector('#chat-threads .chat-thread-row');
                return first && first.getAttribute('data-id') === id ? true : null;
            }, { args: [made[1].id] });
            const pinned = await listRows(h);
            h.eq(pinned[0].id, made[1].id, 'the pinned chat is first');
            h.assert(pinned[0].group !== oldGroup, `and under a new heading: ${pinned[0].group}`);
            h.assert(pinned[1].group !== pinned[0].group, 'the unpinned one kept its date group');

            // Rename it inline, with a double-click.
            await h.eval((id) => {
                const row = document.querySelector(`.chat-thread-row[data-id="${id}"] .chat-thread`);
                row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
                return true;
            }, made[1].id);
            await h.waitFor(() => (document.querySelector('.chat-thread-rename') ? true : null));
            await h.eval(() => {
                const input = document.querySelector('.chat-thread-rename');
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
                if (setter && setter.set) setter.set.call(input, 'Shoulder rig'); else input.value = 'Shoulder rig';
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
                return true;
            });
            await h.waitFor(() => {
                const n = document.querySelector('#chat-threads .chat-thread-title');
                return n && n.textContent === 'Shoulder rig' ? true : null;
            });

            await h.eval(() => window.LolChat.app.repo.flush());
            await h.reload({ flags: {} });
            await waitRows(h, 2);
            const after = await listRows(h);
            h.eq(after[0].title, 'Shoulder rig', 'the rename survived the reload');
            h.eq(after[0].id, made[1].id);
            h.assert(after[0].group !== after[1].group, 'and it is still pinned, in its own group');
            h.note(`groups after reload: ${after.map((r) => r.group).join(' / ')}`);
        },
    },

    {
        name: 'p2-remove-v1',
        timeoutMs: 90000,
        run: async (h) => {
            const v1 = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({
                id: `${1789000000000 + i * 1000}-v1${i}`,
                title: `Old chat ${i}`,
                messages: [
                    { role: 'user', content: `question ${i}` },
                    { role: 'assistant', content: `answer ${i}` },
                ],
            }));

            await seedV1(h, v1(3));
            await h.reload({ flags: {} });
            const migration = await h.eval(() => window.LolChat.migration);
            h.eq(migration.status, 'done', 'the three v1 chats were brought over');
            await waitRows(h, 3);

            // The button only exists because the old key is still there.
            await openSettings(h);
            const ready = await h.waitFor(() => {
                const btn = document.querySelector('.chat-settings-removev1');
                return btn && btn.getAttribute('data-state') === 'ready' ? btn.textContent : null;
            });
            h.assert(ready && ready.length > 0, `the button offers a removal: ${ready}`);

            // Refusing the confirm keeps everything.
            await clickRemoveV1(h);
            await answerDialog(h, false);
            h.eq(await h.eval((k) => (localStorage.getItem(k) === null ? 'gone' : 'present'), V1_KEY), 'present',
                'a refused confirm removes nothing');

            // Accepting it removes the key and leaves the migrated chats alone.
            await clickRemoveV1(h);
            await answerDialog(h, true);
            await h.waitFor((k) => (localStorage.getItem(k) === null ? true : null), { args: [V1_KEY] });
            const rows = await listRows(h);
            h.eq(rows.length, 3, 'the migrated chats are still there');
            h.assert(rows.every((r) => r.title.startsWith('Old chat')), 'with their titles');

            // --- the rollback case: v0.1.45 ran again and wrote a FOURTH chat into the key ---
            await seedV1(h, v1(4));
            await h.reload({ flags: {} });
            // The boot migration brings the newcomer over by itself, so the button is offered only
            // when something is genuinely pending. Simulate the case the plan names: the key gains a
            // chat the store has never seen, with no reload in between.
            await h.eval((key) => {
                const list = JSON.parse(localStorage.getItem(key));
                list.unshift({ id: '1789009999999-v1x', title: 'Rolled back', messages: [{ role: 'user', content: 'written by the old client' }] });
                localStorage.setItem(key, JSON.stringify(list));
                return list.length;
            }, V1_KEY);

            await openSettings(h);
            const pending = await h.waitFor(() => {
                const btn = document.querySelector('.chat-settings-removev1');
                return btn && btn.getAttribute('data-state') === 'pending' ? btn.textContent : null;
            });
            h.assert(/1/.test(pending), `the button offers to bring the straggler over first: ${pending}`);

            await clickRemoveV1(h);
            const nowReady = await h.waitFor(() => {
                const btn = document.querySelector('.chat-settings-removev1');
                return btn && btn.getAttribute('data-state') === 'ready' ? btn.textContent : null;
            });
            h.assert(nowReady, 'once it is over, the button offers the removal again');
            h.eq(await h.eval((k) => (localStorage.getItem(k) === null ? 'gone' : 'present'), V1_KEY), 'present',
                'and the key was NOT removed on the way');

            const titles = await h.eval(async () => (await window.LolChat.app.repo.listThreads()).map((t) => t.title));
            h.assert(titles.includes('Rolled back'), 'the straggler is in the store now');

            await clickRemoveV1(h);
            await answerDialog(h, true);
            await h.waitFor((k) => (localStorage.getItem(k) === null ? true : null), { args: [V1_KEY] });
            const finalTitles = await h.eval(async () => (await window.LolChat.app.repo.listThreads()).map((t) => t.title));
            h.eq(finalTitles.length, 5, 'four old chats plus the rolled-back one survived the removal');
            h.note(`v1 removal: ${finalTitles.length} chats kept, key gone`);
        },
    },
];
