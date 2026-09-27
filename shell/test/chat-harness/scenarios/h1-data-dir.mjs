// @ts-check
// Owner rule 2026-09-27: "all data in data dir including lol chat projects and computer projects".
// LOL Chat's history (and the Computer's graphs, in the same `lol-chat` database) is the window's
// own IndexedDB, so the shell runs the window on session.fromPath(<DATA_DIR>/lol-client). The
// harness main.cjs mirrors that with the REAL prepareClientData, the fake DATA_DIR being
// <userData>/owui-data (the shell's default layout). These scenarios prove, on disk, that what
// LOL Chat saves lands in that folder and that nothing lands in the default session under userData
// — which is where it went up to v0.1.45, and where a regression would put it again.
import fs from 'node:fs';
import path from 'node:path';

const IDB = 'file__0.indexeddb.leveldb';

/** Every file under `dir`, recursively (empty when it does not exist). */
function files(/** @type {string} */ dir) {
    /** @type {string[]} */ const out = [];
    const walk = (/** @type {string} */ d) => {
        let ents = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p); else out.push(p);
        }
    };
    walk(dir);
    return out.sort();
}

/** The file under `dir` whose bytes contain `needle` (latin1: a short ASCII string is stored as is). */
function fileContaining(/** @type {string} */ dir, /** @type {string} */ needle) {
    for (const f of files(dir)) {
        try { if (fs.readFileSync(f).toString('latin1').includes(needle)) return f; } catch { /* locked: skip */ }
    }
    return null;
}

export default [
    {
        name: 'h1-data-dir',
        run: async (h) => {
            const facts = JSON.parse(fs.readFileSync(path.join(h.tmpDir, 'client-data.json'), 'utf8'));
            const dataDir = path.join(h.tmpDir, 'owui-data');
            const clientDir = path.join(dataDir, 'lol-client');
            h.eq(path.resolve(facts.dataDir), path.resolve(dataDir), 'the harness fake DATA_DIR moved');
            h.eq(path.resolve(facts.sessionPath), path.resolve(clientDir),
                'the chat window does not run on <DATA_DIR>/lol-client (still the default session?)');
            h.note(`session at ${path.relative(h.tmpDir, facts.sessionPath)}${facts.built ? ' (prepareClientData from build/main)' : ' (no build: path computed in main.cjs)'}`);

            const legacyIdb = path.join(h.tmpDir, 'IndexedDB');
            const legacyBefore = files(legacyIdb);

            // Save a thread the way LOL Chat does: through the repo, flushed to IndexedDB.
            const marker = `data-dir-proof-${Date.now().toString(36)}`;
            const written = await h.eval(async (title) => {
                const repo = window.LolChat.app.repo;
                await repo.ready;
                const th = repo.createThread({ title });
                repo.appendMessage(th.id, { role: 'user', content: 'where do I live?' });
                await repo.flush();
                return { threadId: th.id, mode: repo.mode };
            }, marker);
            h.eq(written.mode, 'idb', 'the store is IndexedDB');

            const clientIdb = path.join(clientDir, 'IndexedDB', IDB);
            await h.waitFor(() => true);                      // one round-trip: the commit is on disk
            h.assert(fs.existsSync(clientIdb), `no ${path.relative(h.tmpDir, clientIdb)} after a saved thread`);
            h.assert(fs.existsSync(path.join(clientDir, 'Local Storage', 'leveldb')),
                'LOL Chat’s localStorage (prefs, the v1 history key) is not under <DATA_DIR>/lol-client');
            const holder = fileContaining(path.join(clientDir, 'IndexedDB'), marker);
            h.assert(holder, `the saved thread's title is in no file under ${path.relative(h.tmpDir, path.join(clientDir, 'IndexedDB'))}`);
            h.note(`thread title found in ${path.relative(h.tmpDir, /** @type {string} */ (holder))}`);

            // And NOTHING in the default session under userData.
            h.assert(!fs.existsSync(path.join(legacyIdb, IDB)), `LOL Chat wrote ${path.relative(h.tmpDir, path.join(legacyIdb, IDB))} (the default session)`);
            h.eq(files(legacyIdb), legacyBefore, 'a file appeared under <userData>/IndexedDB');
            h.eq(fileContaining(legacyIdb, marker), null, 'the thread reached <userData>/IndexedDB');

            // The thread is really read back from that folder on the next load.
            await h.reload({ flags: {} });
            const back = await h.eval(async (id) => {
                const repo = window.LolChat.app.repo;
                await repo.ready;
                const t = await repo.getThread(id);
                return { mode: repo.mode, title: t && t.title };
            }, written.threadId);
            h.eq(back, { mode: 'idb', title: marker }, 'the thread did not come back after a reload');
        },
    },
];
