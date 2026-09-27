// @ts-check
// The v1 -> v2 IndexedDB upgrade against a REAL IndexedDB (studio plan §3.6.1; S0 review, finding 5).
//
// Every other store scenario (p0-store, p1-store-ui) runs on a FRESH profile, so only the
// oldVersion === 0 path is ever exercised — the path a new install takes, not the path every user
// on shipped v0.1.45 takes. This one opens `lol-chat` at version 1 BY HAND, with the five v1 stores
// and a real conversation in them, then reloads the page and lets main.mjs open the same database
// at DB_VERSION 2. The chats must still be there, and the two new stores must exist.
//
// The page is first loaded with `forceMemoryStore` so the app never touches IndexedDB while we are
// seeding it: a live connection would make the version change block forever.

/** The v1 shape, written out here on purpose — it is a FIXTURE of what shipped, not an import. */
const V1 = {
    threads: { keyPath: 'id', indexes: { updatedAt: 'updatedAt', pinned: 'pinned', legacy: ['legacyId', 'legacyHash'] } },
    messages: { keyPath: 'id', indexes: { threadId: 'threadId', threadParent: ['threadId', 'parentId'] } },
    attachments: { keyPath: 'id', indexes: { threadId: 'threadId', threadSha: ['threadId', 'sha256'] } },
    recipes: { keyPath: 'id', indexes: { trigger: 'trigger' } },
    kv: { keyPath: 'key', indexes: {} },
};

export default [
    {
        name: 's0-store-v2-upgrade',
        run: async (h) => {
            // 1. boot WITHOUT touching IndexedDB, so the seed can own the database.
            await h.reload({ flags: { forceMemoryStore: true } });
            const mode = await h.eval(() => window.LolChat.app.repo.mode);
            h.assert(mode === 'memory' || mode === 'memory-final', 'the seeding boot is memory-backed: ' + mode);

            // 2. write a v1 database by hand: the five stores, a thread, two messages, one kv row.
            const seeded = await h.eval(async (v1) => {
                await new Promise((resolve, reject) => {
                    const req = indexedDB.deleteDatabase('lol-chat');
                    req.onsuccess = () => resolve(undefined);
                    req.onerror = () => reject(new Error('deleteDatabase failed'));
                    req.onblocked = () => resolve(undefined);
                });
                const db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open('lol-chat', 1);
                    req.onupgradeneeded = () => {
                        for (const [name, def] of Object.entries(v1)) {
                            const store = req.result.createObjectStore(name, { keyPath: def.keyPath });
                            for (const [index, path] of Object.entries(def.indexes)) {
                                store.createIndex(index, path, { unique: false });
                            }
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(new Error('open v1 failed'));
                });
                const now = Date.now();
                const thread = {
                    id: 'v1-thread', title: 'Rig notes', titleSource: 'user', createdAt: now, updatedAt: now,
                    headId: 'v1-m2', pinned: false, ephemeral: false, recipeId: null, systemOverride: null,
                    params: null, model: null, modelSource: null, farmId: null, draft: null,
                };
                const msg = (id, parentId, role, content) => ({
                    id, threadId: 'v1-thread', parentId, role, createdAt: now, updatedAt: now,
                    parts: [], content, reasoning: null, reasoningMs: null, sawToolCalls: false,
                    model: null, underlying: null, farmName: null, farmId: null, params: null,
                    recipeId: null, stats: null, status: 'done', error: null, pinned: false,
                });
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(['threads', 'messages', 'kv'], 'readwrite');
                    tx.objectStore('threads').put(thread);
                    // v1 stores a root's parentId as '' — never null (schema.mjs shape rule).
                    tx.objectStore('messages').put(msg('v1-m1', '', 'user', 'what GPU?'));
                    tx.objectStore('messages').put(msg('v1-m2', 'v1-m1', 'assistant', 'an A6000 Pro'));
                    tx.objectStore('kv').put({ key: 'ui:lastThreadId', value: 'v1-thread' });
                    tx.oncomplete = () => resolve(undefined);
                    tx.onerror = () => reject(new Error('seed transaction failed'));
                });
                const version = db.version;
                const stores = [...db.objectStoreNames];
                db.close();
                return { version, stores };
            }, V1);
            h.eq(seeded.version, 1, 'the seed really is a version-1 database');
            h.eq(seeded.stores.slice().sort(), ['attachments', 'kv', 'messages', 'recipes', 'threads'],
                'with exactly the v1 stores');

            // 3. reload as a normal launch: main.mjs opens the SAME database at DB_VERSION 2.
            await h.reload({ flags: {} });

            const after = await h.eval(async () => {
                const repo = window.LolChat.app.repo;
                await repo.ready;
                const thread = await repo.getThread('v1-thread');
                const path = await repo.getPath('v1-thread');
                const last = await repo.kvGet('ui:lastThreadId', null);
                const db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open('lol-chat');
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(new Error('reopen failed'));
                });
                const out = {
                    mode: repo.mode,
                    version: db.version,
                    stores: [...db.objectStoreNames].sort(),
                    title: thread ? thread.title : null,
                    headId: thread ? thread.headId : null,
                    contents: path.map((m) => m.content),
                    parents: path.map((m) => m.parentId),
                    threads: (await repo.listThreads()).length,
                    last,
                };
                db.close();
                return out;
            });

            h.eq(after.mode, 'idb', 'the upgraded database opened as IndexedDB, not a memory fallback');
            h.eq(after.version, 2, 'and it is at DB_VERSION 2');
            h.eq(after.stores, ['attachments', 'graphs', 'kv', 'messages', 'projects', 'recipes', 'threads'],
                'the two v2 stores were added and none of the v1 stores was dropped');
            h.eq(after.title, 'Rig notes', 'the v1 thread survived the upgrade');
            h.eq(after.headId, 'v1-m2', 'with its head intact');
            h.eq(after.contents, ['what GPU?', 'an A6000 Pro'], 'both messages survived');
            h.eq(after.parents, [null, 'v1-m1'], 'and the parent chain reads back through fromStore');
            h.eq(after.threads, 1, 'exactly one thread, not a duplicate from a re-migration');
            h.eq(after.last, 'v1-thread', 'the kv row came across too');

            // 4. and the new stores are usable, not just present.
            const wrote = await h.eval(async () => {
                const db = await new Promise((resolve, reject) => {
                    const req = indexedDB.open('lol-chat');
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(new Error('reopen failed'));
                });
                const value = await new Promise((resolve, reject) => {
                    const tx = db.transaction(['graphs', 'projects'], 'readwrite');
                    tx.objectStore('graphs').put({ id: 'g1', threadId: 'v1-thread', updatedAt: 1 });
                    tx.objectStore('projects').put({ id: 'p1', threadId: 'v1-thread', updatedAt: 1 });
                    const get = tx.objectStore('graphs').index('threadId').getAll('v1-thread');
                    tx.oncomplete = () => resolve(get.result.length);
                    tx.onerror = () => reject(new Error('v2 store write failed'));
                });
                db.close();
                return value;
            });
            h.eq(wrote, 1, 'the graphs store and its threadId index work');
            return null;
        },
    },
];
