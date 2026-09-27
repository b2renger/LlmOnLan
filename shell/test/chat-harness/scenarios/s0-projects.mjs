// @ts-check
// S0-U4 in the real browser: the scratch-projects API end to end — page → preload → ipcMain → the
// compiled main-process API → real files in the harness's temp root, and back. The unit tests own
// the refusal table; what only these scenarios can prove is that the WIRING is real: that a write
// from the page lands on disk with the right bytes, that `reveal` reaches Electron's `shell` (and
// opens nothing), that an escape attempt is refused across the bridge, and that a build without
// the IPC degrades to the memory backend with one honest sentence instead of a dead panel.

const PROJECT = { name: 'Harness sketch', kind: 'p5' };
const SKETCH = 'function setup(){ createCanvas(400, 400); }';
const LIB = '// a pinned copy of p5, as a project would carry it';

/** Everything the page can tell us about one round-trip. Runs in the page. */
const roundTrip = (h) => h.eval(async (meta, sketch, lib) => {
    const api = window.LolChat.app.projects;
    const created = await api.create(meta);
    if (!created.ok) return { created };
    const id = created.project.id;
    const w1 = await api.write(id, 'sketch.js', sketch);
    const w2 = await api.write(id, 'lib/p5.js', lib);
    const read = await api.read(id, 'sketch.js');
    const files = await api.listFiles(id);
    const where = await api.path(id);
    const revealed = await api.reveal(id);
    return { id, created, w1, w2, read, files, where, revealed, kind: api.kind() };
}, PROJECT, SKETCH, LIB);

export default [
    {
        name: 's0-projects-real',
        needsProjects: 'real',
        run: async (h) => {
            h.eq(await h.projects.kind(), 'real', 'the preload exposed the projects API');

            const root = await h.projects.root();
            h.assert(root.ok, 'root() answers');
            h.assert(/projects$/.test(String(root.path).replace(/[\\/]+$/, '')),
                `the root is the harness temp root, not the user's data folder (${root.path})`);

            const r = await roundTrip(h);
            h.assert(r.created && r.created.ok, `create failed: ${JSON.stringify(r.created)}`);
            h.assert(/^[a-z0-9][a-z0-9-]{0,47}-[a-z0-9]{8}$/.test(r.id), `minted id ${r.id}`);
            h.assert(r.w1.ok && r.w2.ok, 'both writes were accepted');
            h.eq(r.read.text, SKETCH, 'what the page wrote is what the page reads back');
            h.eq(r.files.files.map((f) => f.path), ['lib/p5.js', 'sketch.js'], 'listFiles, project.json excluded');

            // The claim that only the harness can check: those bytes are on disk.
            const onDisk = h.files(r.id);
            const byPath = Object.fromEntries(onDisk.map((f) => [f.path, f.size]));
            h.eq(byPath['sketch.js'], SKETCH.length, 'sketch.js is on disk with the expected bytes');
            h.eq(byPath['lib/p5.js'], LIB.length, 'and so is the file in the subfolder');
            h.assert(byPath['project.json'] > 0, 'the metadata sits beside them, not in a central index');
            h.assert(!onDisk.some((f) => f.path.endsWith('.tmp')), 'no temp file was left behind');

            // reveal() reached Electron's shell — and opened nothing (main.cjs only records).
            const calls = h.shellCalls();
            h.assert(r.revealed.ok, 'reveal answered ok');
            h.assert(calls.some((c) => c.call === 'showItemInFolder' && c.path.endsWith(r.id)),
                `showItemInFolder was recorded for ${r.id}: ${JSON.stringify(calls)}`);
            h.assert(!calls.some((c) => c.call === 'openPath'), 'nothing was opened');
            h.eq(r.where.path, calls.find((c) => c.call === 'showItemInFolder').path,
                'path() hands the UI the same folder reveal points at — that is "Copy path"');

            // An escape attempt from the page is refused across the bridge, and writes nothing.
            const escapes = await h.eval(async (id) => {
                const api = window.LolChat.app.projects;
                const tried = ['../escaped.js', '../../escaped.js', 'a/../../escaped.js', '/etc/passwd',
                    'C:/Windows/win.ini', '.git/config', 'evil.exe', 'con.js'];
                const out = [];
                for (const rel of tried) out.push({ rel, r: await api.write(id, rel, 'pwned') });
                return out;
            }, r.id);
            for (const e of escapes) {
                h.assert(!e.r.ok, `the page was allowed to write ${e.rel}`);
                h.assert(e.r.code === 'E_PATH' || e.r.code === 'E_EXT', `${e.rel} -> ${e.r.code}`);
            }
            h.eq(h.files(r.id).length, 3, 'the project still holds exactly the three files it should');

            // An id the page invented resolves to nothing at all.
            const invented = await h.eval(() => window.LolChat.app.projects.read('invented-abcd1234', 'sketch.js'));
            h.eq(invented.code, 'E_MISSING', 'a well-formed id for a project that does not exist');

            h.note(`wrote ${onDisk.length} files to ${r.where.path}; ${escapes.length} escape attempts refused`);
        },
    },

    {
        name: 's0-projects-memory',
        // The degradation path, which is what an older shell binary (or a harness without the
        // compiled main output) actually looks like: no `window.lol.projects`, so the SAME
        // interface is served from memory and every project surface shows one honest sentence.
        run: async (h) => {
            const r = await h.eval(async (sentence) => {
                const mod = window.LolChat.app.modules.projects;
                if (!mod) return { error: 'the projects module did not load' };
                const mem = mod.createProjects(null);          // exactly what a missing door gives
                const created = await mem.create({ name: 'Unsaved sketch', kind: 'p5' });
                const w = await mem.write(created.project.id, 'sketch.js', 'ellipse(1,2,3);');
                const back = await mem.read(created.project.id, 'sketch.js');
                const escape = await mem.write(created.project.id, '../x.js', 'no');
                const noFolder = await mem.path(created.project.id);

                const host = document.createElement('div');
                document.body.appendChild(host);
                const note = mod.renderNotice(host, mem);
                const shown = note ? note.textContent : null;
                const styled = note ? getComputedStyle(note).borderTopWidth : null;
                host.remove();

                return {
                    kind: mem.kind(), id: created.project.id, ok: created.ok && w.ok,
                    text: back.text, escape, noFolder, shown, styled, sentence,
                    notice: mem.notice(),
                };
            }, 'this build has no projects folder; sketches run but are not saved');

            h.assert(!r.error, String(r.error));
            h.eq(r.kind, 'memory', 'with no door the bridge falls back to the memory backend');
            h.assert(r.ok, 'a sketch can still be created and written');
            h.eq(r.text, 'ellipse(1,2,3);', 'and read back — it just never reaches a disk');
            h.eq(r.escape.code, 'E_PATH', 'the memory backend refuses the same paths');
            h.eq(r.noFolder.code, 'E_ROOT', 'there is no folder to reveal or copy');

            h.eq(r.shown, r.sentence, 'the fallback sentence is the one the plan promises');
            h.eq(r.notice, r.sentence);
            h.assert(r.styled === '1px', `css/projects.css styles the note (border-top ${r.styled})`);

            // And nothing reached the disk under that id.
            h.eq(h.files(r.id).length, 0, 'the memory backend wrote no files');
            h.note('memory fallback: sketches run, nothing is saved, and the UI says so');
        },
    },
];
