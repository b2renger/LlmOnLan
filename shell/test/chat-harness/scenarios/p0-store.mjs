// @ts-check
// P0-U4 in the real browser: the store against a REAL IndexedDB, and the v1 migration against a
// REAL localStorage. The unit tests run the same repo over a memory backend; only these scenarios
// can prove the IndexedDB path, the reload, the late attach and the boot sequence of main.mjs
// §3.1 step 12. They drive `LolChat.app.repo` directly — no controller, no farm, no completions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, '..', '..', 'chat', 'fixtures', 'v1');
const V1_KEY = 'lol.chat.threads.v1';

const fixture = (/** @type {string} */ name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** Seed the v1 history key exactly as v0.1.45 would have left it. */
const seedV1 = (/** @type {any} */ h, /** @type {string} */ raw) =>
    h.eval((key, text) => { localStorage.setItem(key, text); return localStorage.getItem(key).length; }, V1_KEY, raw);

/** Write a thread + messages through the repo and hand back what it returned. */
const writeThread = (/** @type {any} */ h, /** @type {string} */ title, /** @type {string[]} */ texts) =>
    h.eval(async (t, list) => {
        const repo = window.LolChat.app.repo;
        const th = repo.createThread({ title: t });
        const ids = list.map((text, i) => repo.appendMessage(th.id, { role: i % 2 ? 'assistant' : 'user', content: text }).id);
        await repo.flush();
        return { threadId: th.id, ids, mode: repo.mode };
    }, title, texts);

/** Everything a scenario wants to know about one thread after a reload. */
const readThread = (/** @type {any} */ h, /** @type {string} */ threadId) =>
    h.eval(async (id) => {
        const repo = window.LolChat.app.repo;
        const thread = await repo.getThread(id);
        const path2 = await repo.getPath(id);
        return {
            mode: repo.mode,
            thread,
            contents: path2.map((m) => m.content),
            statuses: path2.map((m) => m.status),
            parents: path2.map((m) => m.parentId),
            threads: (await repo.listThreads()).length,
        };
    }, threadId);

export default [
    {
        name: 'p0-store-idb',
        // The plain case: what a user writes is in IndexedDB and is still there on the next launch.
        run: async (h) => {
            const written = await writeThread(h, 'Rig notes', ['what GPU?', 'an A6000 Pro']);
            h.eq(written.mode, 'idb', 'a healthy browser opens the database well inside the timeout');
            h.assert(written.ids.length === 2, 'two messages were appended');

            await h.reload({ flags: {} });                     // same origin, same database
            const after = await readThread(h, written.threadId);
            h.eq(after.mode, 'idb', 'the reopened store is IndexedDB');
            h.eq(after.contents, ['what GPU?', 'an A6000 Pro'], 'both messages survived the reload');
            h.eq(after.parents, [null, written.ids[0]], 'the parent chain survived too');
            h.eq(after.thread.headId, written.ids[1], 'and the head still points at the last message');
            h.eq(after.threads, 1);
            h.note(`stored thread ${written.threadId} read back after a reload`);
        },
    },

    {
        name: 'p0-store-tx-atomic',
        // §3.4's runTx is the one call that reports failure, and the v1 import relies on it being
        // all-or-nothing (a thread committed without its messages would be found by `findLegacy`
        // on the next boot and skipped forever — a permanently empty chat). IndexedDB AUTO-COMMITS
        // what the callback already wrote unless the transaction is aborted, so only a real
        // browser can prove this: the memory backend rolls back on its own.
        run: async (h) => {
            const out = await h.eval(async () => {
                const repo = window.LolChat.app.repo;
                await repo.ready;
                const mode = repo.mode;
                let threw = null;
                try {
                    await repo.runTx(['threads', 'messages'], 'readwrite', async (tx) => {
                        await tx.put('threads', { id: 'tx-a', title: 'half written', createdAt: 1, updatedAt: 1, headId: null });
                        await tx.put('messages', { id: 'tx-m', threadId: 'tx-a', parentId: '', role: 'user', content: 'x', createdAt: 1, updatedAt: 1 });
                        throw new Error('disk on fire');
                    });
                } catch (err) { threw = String(err && err.message); }
                return {
                    mode,
                    threw,
                    thread: await repo.getThread('tx-a'),
                    messages: (await repo.getMessages('tx-a')).length,
                    threads: (await repo.listThreads()).length,
                };
            });
            h.eq(out.mode, 'idb', 'this scenario is meaningless unless the real database is open');
            h.eq(out.threw, 'disk on fire', 'runTx reports the failure to its caller');
            h.eq(out.thread, null, 'the row written before the throw must NOT be committed');
            h.eq(out.messages, 0);
            h.eq(out.threads, 0, 'the whole transaction was rolled back');

            // The aborted transaction must not leave an unawaited rejection behind either: the
            // run loop turns any page console error into a failure, so give it a moment to land.
            await h.sleep(250);
            h.eq(h.consoleErrors(), [], 'an aborted transaction must not log an unhandled rejection');

            // …and the store still works afterwards.
            const written = await writeThread(h, 'after the abort', ['still writable']);
            h.eq(written.mode, 'idb');
            h.eq((await readThread(h, written.threadId)).contents, ['still writable']);
        },
    },

    {
        name: 'p0-store-late-idb',
        timeoutMs: 90000,
        // A slow disk: the open misses the 3 s timeout, the chat keeps working in memory, and the
        // database attaches AFTER — replaying everything typed in the meantime.
        run: async (h) => {
            // A v1 history is present from the start, so the step-12 block has real work to do the
            // moment a database exists — that is what makes the re-run below observable.
            await seedV1(h, fixture('three.json'));
            await h.reload({ flags: { idbOpenDelayMs: 4500 } });
            const modes = await h.eval(() => {
                window.__modes = [];
                window.LolChat.app.bus.on('store:mode', (m) => window.__modes.push(m));
                return { mode: window.LolChat.app.repo.mode, state: window.LolChat.app.state.storeMode };
            });
            h.eq(modes.mode, 'pending', 'the repo is usable before the database is open');

            // Typed while the store is still in memory (after the timeout has fired).
            await h.waitFor(() => window.LolChat.app.repo.mode === 'memory', { timeout: 8000 });
            const memoryState = await h.eval(() => ({ mode: window.LolChat.app.repo.mode, state: window.LolChat.app.state.storeMode, journal: window.LolChat.app.repo.debug.journalLength() }));
            h.eq(memoryState.state, 'memory', 'core/app.mjs followed the STORE_MODE event');
            // Captured BEFORE the attach: a memory store cannot migrate, so this is the skipped verdict.
            const memoryVerdict = await h.eval(async () => await window.LolChat.migration);
            const written = await writeThread(h, 'Typed while waiting', ['does this survive?']);
            h.eq(written.mode, 'memory', 'the write happened in the memory window');
            h.assert((await h.eval(() => window.LolChat.app.repo.debug.journalLength())) > memoryState.journal, 'the write was journalled for replay');

            const attached = await h.waitFor(() => (window.LolChat.app.repo.mode === 'idb'
                ? { modes: window.__modes.slice(), journal: window.LolChat.app.repo.debug.journalLength() }
                : null), { timeout: 8000 });
            h.eq(attached.modes, ['memory', 'idb'], 'the two transitions were announced on the bus');
            h.eq(attached.journal, 0, 'the journal was replayed and cleared');

            // The part that actually matters: main.mjs REPLACES LolChat.migration on the attach
            // (§3.1 step 12, the THREADS_CHANGED{reason:'attach'} listener). Before the attach the
            // block can only answer 'skipped/memory' — a memory store never migrates — so a v1
            // history typed before the attach and a v1 history migrated after it must both hold.
            h.eq(memoryVerdict, { status: 'skipped', reason: 'memory', imported: 0, copies: 0, skipped: 0 },
                'while the store is in memory the migration must report itself skipped');
            const afterAttach = await h.waitFor(async () => {
                const m = await window.LolChat.migration;
                return m && m.status !== 'skipped' ? m : null;
            }, { timeout: 8000 });
            h.eq(afterAttach.status, 'done', 'the late attach did not re-run the step-12 migration');
            h.eq(afterAttach.imported, 3, 'the 3-thread v1 fixture was imported on the attach');
            h.assert((await h.eval(() => window.localStorage.getItem('lol.chat.threads.v1') !== null)),
                'the v1 key must survive the migration');

            await h.reload({ flags: {} });
            const after = await readThread(h, written.threadId);
            h.eq(after.mode, 'idb');
            h.eq(after.contents, ['does this survive?'], 'what was typed during the memory window is on disk');
            h.assert(after.threads >= 4, `the 3 migrated threads and the typed one should all be there (${after.threads})`);
            h.note('pending → memory (3 s) → idb (4.5 s), journal replayed once, migration re-run on attach');
        },
    },

    {
        name: 'p0-store-memory-final',
        // The honest dead end: no database at all. The chat still works for this session, says so,
        // and — the part that matters — does not touch the v1 copy it cannot replace.
        run: async (h) => {
            await seedV1(h, fixture('three.json'));
            await h.reload({ flags: { forceMemoryStore: true } });
            const state = await h.eval(() => ({
                mode: window.LolChat.app.repo.mode,
                state: window.LolChat.app.state.storeMode,
                journal: window.LolChat.app.repo.debug.journalLength(),
            }));
            h.eq(state.mode, 'memory-final');
            h.eq(state.state, 'memory-final', 'the app state followed');

            const written = await writeThread(h, 'This session only', ['hello', 'hi']);
            const live = await readThread(h, written.threadId);
            h.eq(live.contents, ['hello', 'hi'], 'writing still works');
            h.eq(state.journal, 0, 'nothing is queued for a replay that will never come');

            const migration = await h.eval(() => window.LolChat.migration);
            h.eq(migration.status, 'skipped', 'the migration never runs in a memory mode');
            h.eq(migration.reason, 'memory');
            h.eq(await h.eval((k) => localStorage.getItem(k) !== null, V1_KEY), true, 'the v1 history is left alone');

            await h.reload({ flags: {} });
            const after = await readThread(h, written.threadId);
            h.eq(after.thread, null, 'a memory-final session really is gone at the next launch');
            h.eq(after.mode, 'idb', 'and the next launch opens the database normally');
            h.eq(await h.eval((k) => localStorage.getItem(k) !== null, V1_KEY), true, 'the v1 history is STILL there');
        },
    },

    {
        name: 'p0-store-checkpoint',
        timeoutMs: 90000,
        // A reply that was streaming when the window died: the checkpoint put it on disk, and the
        // next boot turns it from 'streaming' into 'interrupted' (§3.1 step 12).
        run: async (h) => {
            const written = await h.eval(async () => {
                const repo = window.LolChat.app.repo;
                const th = repo.createThread({ title: 'Interrupted' });
                repo.appendMessage(th.id, { role: 'user', content: 'tell me a long story' });
                const reply = repo.appendMessage(th.id, { role: 'assistant', content: '', status: 'streaming' });
                for (const chunk of ['Once ', 'upon ', 'a ', 'time']) {
                    reply.content += chunk;
                    repo.checkpoint(reply);                       // ≤ 1 write per second, trailing
                }
                return { threadId: th.id, replyId: reply.id };
            });
            await h.sleep(1400);                                  // let the 1 s throttle fire for real
            await h.eval(() => window.LolChat.app.repo.flush());

            await h.reload({ flags: {} });
            const recovered = await h.eval(async (id) => {
                await window.LolChat.migration;                   // step 12 ran: migration + recovery
                const repo = window.LolChat.app.repo;
                const msgs = await repo.getMessages(id);
                const reply = msgs.find((m) => m.role === 'assistant');
                return { mode: repo.mode, status: reply ? reply.status : null, content: reply ? reply.content : null, again: await repo.recoverInterrupted() };
            }, written.threadId);

            h.eq(recovered.mode, 'idb');
            h.eq(recovered.content, 'Once upon a time', 'the checkpoint wrote the latest text');
            h.eq(recovered.status, 'interrupted', 'a half-written reply is never left claiming to stream');
            h.eq(recovered.again, 0, 'and the recovery is idempotent');
        },
    },

    {
        name: 'p0-store-migrate',
        timeoutMs: 120000,
        // The upgrade path: v0.1.45's localStorage history appears in the new store, exactly once,
        // and the old copy is left where a rollback can still read it.
        run: async (h) => {
            await seedV1(h, fixture('three.json'));
            await h.reload({ flags: {} });

            const first = await h.eval(async () => {
                const result = await window.LolChat.migration;
                const threads = await window.LolChat.app.repo.listThreads();
                return {
                    result,
                    titles: threads.map((t) => t.title),
                    imported: threads.every((t) => t.imported === true),
                    legacy: threads.every((t) => typeof t.legacyId === 'string' && typeof t.legacyHash === 'string'),
                    keyPresent: localStorage.getItem('lol.chat.threads.v1') !== null,
                };
            });
            h.eq(first.result.status, 'done');
            h.eq(first.result.imported, 3);
            h.eq(first.result.copies, 0);
            h.eq(first.titles, ['Rig notes', 'Kitchen table', 'New chat'], 'v1 order is preserved (newest first)');
            h.assert(first.imported && first.legacy, 'every imported thread carries its legacy identity');
            h.assert(first.keyPresent, 'the v1 key is NEVER removed by the migration');

            // Calling it AGAIN on the same page must be a no-op: the raw text has not changed, so
            // it takes the cheap `already` path and imports nothing a second time.
            const second = await h.eval(async () => {
                const app = window.LolChat.app;
                const result = await app.modules.migrate.migrateV1({
                    repo: app.repo, storage: localStorage, now: Date.now, bus: app.bus,
                });
                return { result, count: (await app.repo.listThreads()).length };
            });
            h.eq(second.result.status, 'already', 'a second run on the same page re-imports nothing');
            h.eq(second.result.imported, 0);
            h.eq(second.count, 3, 'and the thread count did not move');

            await h.reload({ flags: {} });
            const reboot = await h.eval(async () => {
                const result = await window.LolChat.migration;
                const threads = await window.LolChat.app.repo.listThreads();
                return { result, count: threads.length, titles: threads.map((t) => t.title) };
            });
            h.eq(reboot.result.status, 'already', 'the cheap boot path: the raw text has not changed');
            h.eq(reboot.count, 3, 'nothing was imported twice');
            h.eq(reboot.titles, ['Rig notes', 'Kitchen table', 'New chat']);

            // A big history must never hold up the first paint: ready is true while it is still
            // running (the store is deliberately slow here so the race is not a coin toss).
            await h.fresh({ flags: {} });                    // a clean origin: 100 threads and nothing else
            await seedV1(h, fixture('hundred.json'));
            await h.reload({ flags: { idbOpenDelayMs: 1500 } });
            const boot = await h.eval(() => new Promise((resolve) => {
                let settled = false;
                window.LolChat.migration.then(() => { settled = true; });
                setTimeout(() => resolve({ ready: window.LolChat.ready === true, settled, mode: window.LolChat.app.repo.mode }), 0);
            }));
            h.assert(boot.ready, 'LolChat.ready is true before the migration finishes');
            h.assert(!boot.settled, 'and the migration really was still pending at that moment');

            const big = await h.eval(async () => {
                const result = await window.LolChat.migration;
                const threads = await window.LolChat.app.repo.listThreads();
                return { result, count: threads.length, first: threads[0].title, last: threads[threads.length - 1].title };
            });
            h.eq(big.result.status, 'done');
            h.eq(big.result.imported, 100);
            h.eq(big.count, 100, 'the whole v1 store, on a clean origin');
            h.eq(big.first, 'Chat 1', 'the newest v1 thread is still first');
            h.eq(big.last, 'Chat 100', 'and the oldest is last');
            h.note('migrated 3 threads, then 100 on a clean origin; the v1 key was never removed');
        },
    },
];
