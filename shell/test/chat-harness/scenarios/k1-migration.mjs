// @ts-check
// The per-thread graphs come over (COMPUTER_PLAN §7.2 — K1-U2).
//
// This is the scout's Risk 4, both halves, and it is the only part of K1 that touches data a
// reader already has:
//
//   half one   a graph whose chat is GONE still comes over, with words instead of a blank title;
//   half two   `repo.deleteThread` cascades to every `graphs` row indexed to that thread
//              (state/repo.mjs:320-326), so the migration COPIES. Deleting the chat afterwards
//              must take the original and leave the library document standing.
//
// Plus the thing a person would actually notice going wrong: a second launch must not double
// their library.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** One call on the library's debug door. @param {any} h @param {string} name @param {any[]} args */
const lib = (h, name, ...args) => h.eval((n, a) => {
    const d = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.library;
    if (!d) throw new Error('no window.LolComputer.debug.library: the library did not mount');
    if (typeof d[n] !== 'function') throw new Error('debug.library has no ' + n + '()');
    return d[n](...a);
}, name, args);

/** Open the Computer and wait until the library has finished its first paint. @param {any} h */
async function ready(h) {
    await h.view('computer');
    await h.waitFor(() => {
        const d = window.LolComputer && window.LolComputer.debug && window.LolComputer.debug.library;
        return d && typeof d.openId === 'function' && d.openId() ? d.openId() : null;
    }, { timeout: 20000 });
}

/** The migration's verdict, awaited. @param {any} h */
const verdict = (h) => h.eval(() => (window.LolComputer && window.LolComputer.migration) || null);

/**
 * Two thread-owned graphs, written straight into the `graphs` store the way the chat's panel left
 * them: one belonging to a chat that still exists, one whose chat is gone. Then the marker that
 * says "this account has already been through it" is cleared, so the NEXT load migrates.
 * @param {any} h
 */
const seed = (h) => h.eval(async () => {
    const repo = window.LolChat.app.repo;
    await repo.ready;
    const alive = repo.createThread({ title: 'Rig notes' });
    const part = (id) => ({
        id, type: 'note', x: 0, y: 0, w: 220, h: 140, settings: { text: 'hello' },
        state: 'idle', value: null, error: null, stats: null,
    });
    await repo.putGraph({
        id: 'g-alive', threadId: alive.id, title: '', createdAt: 1, updatedAt: 2, rev: 1,
        parts: [part('p1')], wires: [], settings: {}, view: { x: 0, y: 0, zoom: 1 },
    });
    // A graph whose chat is GONE: the thread row it names does not exist. §7.2's `thread may be
    // gone` — the state a reader is left in after deleting a chat on an older build.
    await repo.putGraph({
        id: 'g-orphan', threadId: 'thread-that-is-gone', title: '', createdAt: 1, updatedAt: 3, rev: 1,
        parts: [part('p1'), part('p2')], wires: [], settings: {}, view: { x: 0, y: 0, zoom: 1 },
    });
    await repo.kvSet('computer:migratedV1', false);
    return { aliveThread: alive.id };
});

export default [
    {
        name: 'k1-migration-brings-graphs-over',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await ready(h);

            // A first launch with nothing to carry over still marks itself done, so the cost is
            // paid once and not on every launch for the rest of the product's life.
            const nothing = await verdict(h);
            h.eq(nothing.status, 'none', 'nothing to migrate on a fresh database');
            const baseline = (await lib(h, 'list')).length;

            const { aliveThread } = await seed(h);
            await h.reload();
            await ready(h);

            const done = await verdict(h);
            h.eq(done.status, 'done', 'the second load migrated');
            h.eq(done.imported, 2, 'both thread-owned graphs came over');

            const rows = await lib(h, 'list');
            h.eq(rows.length, baseline + 2, 'the library grew by exactly two');
            const titles = rows.map((/** @type {any} */ r) => r.title);
            h.assert(titles.indexOf('From: Rig notes') >= 0,
                'the graph whose chat is still there is named after it: ' + JSON.stringify(titles));
            h.assert(titles.indexOf('From a deleted chat') >= 0,
                'and the orphan gets words rather than a blank title: ' + JSON.stringify(titles));

            const orphan = rows.find((/** @type {any} */ r) => r.title === 'From a deleted chat');
            h.eq(orphan.parts, 2, 'the parts came with it');

            // COPY, NEVER MOVE: the originals are exactly where the chat left them.
            const originals = await h.eval(async () => {
                const repo = window.LolChat.app.repo;
                const a = await repo.getGraph('g-alive');
                const b = await repo.getGraph('g-orphan');
                return { a: a ? a.threadId : null, b: b ? b.threadId : null };
            });
            h.assert(originals.a && originals.b, 'both per-thread rows are still there, untouched');

            // HALF TWO. Deleting the surviving chat cascades to ITS graphs row — and must not
            // touch the library document that was copied out of it.
            const after = await h.eval(async (threadId) => {
                const repo = window.LolChat.app.repo;
                await repo.deleteThread(threadId);
                const gone = await repo.getGraph('g-alive');
                const all = await repo.listGraphs();
                return { gone: !gone, library: all.filter((r) => r.threadId === null).length };
            }, aliveThread);
            h.assert(after.gone, 'the cascade took the per-thread row');
            h.eq(after.library, baseline + 2, 'and left every library document standing');

            await lib(h, 'render');
            const still = await lib(h, 'list');
            h.assert(still.some((/** @type {any} */ r) => r.title === 'From: Rig notes'),
                'the migrated copy is still in the sidebar after its chat was deleted');
        },
    },

    {
        // A second launch must not double the library. The kv marker is the fast path; the derived
        // id `'lib-' + hash(row.id)` is what makes it true even when the marker never landed.
        name: 'k1-migration-is-idempotent',
        needsMock: true,
        timeoutMs: 180000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await h.fresh();
            await ready(h);
            const baseline = (await lib(h, 'list')).length;

            await seed(h);
            await h.reload();
            await ready(h);
            h.eq((await verdict(h)).imported, 2);
            h.eq((await lib(h, 'list')).length, baseline + 2);

            // The ordinary second launch: the marker is set, nothing is read.
            await h.reload();
            await ready(h);
            h.eq((await verdict(h)).status, 'already', 'the marker is the fast path');
            h.eq((await lib(h, 'list')).length, baseline + 2, 'two, not four');

            // The crash case: the rows were written but the marker never landed.
            await h.eval(async () => {
                const repo = window.LolChat.app.repo;
                await repo.ready;
                await repo.kvSet('computer:migratedV1', false);
            });
            await h.reload();
            await ready(h);
            const again = await verdict(h);
            h.eq(again.status, 'done');
            h.eq(again.imported, 0, 'nothing was written a second time');
            h.eq(again.skipped, 2, 'both were recognised by their derived ids');
            h.eq((await lib(h, 'list')).length, baseline + 2, 'still two, not four');
        },
    },
];
