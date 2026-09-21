// @ts-check
// C3-U2 in the real browser: Code, Render and File against the real sandbox, the real projects API
// and the real mock farm (plan §2.6 BJ-17, docs/LOLCHAT_COMPUTER_SPEC.md §3/§7).
//
// The unit tests own the marshalling, the sentences and the SVG sanitiser against fakes. What only
// these scenarios can show:
//   - a Code part really computes in the guest, and the farm sees NOTHING while it does (the whole
//     point of the part: arithmetic must not cost a generation);
//   - a list really arrives whole — one compute, not one per item;
//   - a guest error really becomes a sentence on the part with no `file:` path in it;
//   - Render really produces a picture value the canvas paints;
//   - File really puts bytes on disk inside the project root, a second run overwrites rather than
//     multiplying files, and a `..` is refused by the MAIN PROCESS (needsProjects:'real'), not by
//     renderer politeness.

const COMPLETIONS = '/v1/chat/completions';

/** Network noise the farm's own error paths make in the console. */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** A string as the page resolves it, so a test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((k, v) => window.LolChat.app.t(k, v || undefined), key, vars || null);

/** A thread, then the Computer panel open on it (the C1/C2 opening, unchanged). */
async function open(/** @type {any} */ h) {
    await h.submit('a thread to hang a computer on');
    await h.waitReply();
    await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = await app.repo.listThreads();
        return app.controller.selectThread(rows[0].id);
    });
    await h.mock.reset();                       // every count below is about the GRAPH
    await h.graph.open();
    await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));
}

/** The live parts, by id — off the DOC, where the runner writes value/state/error. */
const parts = async (/** @type {any} */ h) => {
    const doc = await h.graph.doc();
    /** @type {Record<string, any>} */ const out = {};
    for (const p of doc.parts) out[p.id] = p;
    return out;
};

/** What the sandbox host says about itself (API_KEYS.graphDebug.sandbox). */
const sandboxState = (/** @type {any} */ h) => h.graph.call('sandbox');

export default [
    {
        name: 'c3-parts-code-computes-without-the-farm',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The reason the part exists: deterministic work, in the guest, for zero generations.
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const code = await h.graph.place('code', 340, 40);
            await h.graph.set(note, { text: '3\n1\n2' });
            await h.graph.set(code, {
                code: 'const ns = inputs.in[0].split("\\n").map(Number); ns.sort((a, b) => a - b); return ns.join(",");',
            });
            h.eq((await h.graph.wire(note, code, 'in')).ok, true, 'Note feeds Code');

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `no part failed: ${JSON.stringify(report.errors)}`);

            const live = await parts(h);
            h.eq(live[code].state, 'done');
            h.eq(String(live[code].value.data), '1,2,3', 'the guest really ran the code and sorted the numbers');
            h.eq(live[code].value.kind, 'text', 'a returned string is a text value');

            const posts = await h.mock.log({ path: COMPLETIONS });
            h.eq(posts.length, 0, `sorting three numbers cost ZERO generations, got ${posts.length}`);
            h.eq(report.generations, 0, 'and the run agrees it spent nothing');

            const box = await sandboxState(h);
            h.assert(box && box.framed === true, `the sandbox really booted: ${JSON.stringify(box)}`);
            h.note(`compute state=${box.state} runs=${box.runs}`);
        },
    },

    {
        name: 'c3-parts-code-takes-a-list-whole',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // BJ-9: Code DECLINES to fan. Forty items are one program, not forty — and the proof is
        // that a Split of three items produces ONE compute whose answer is about all three.
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const split = await h.graph.place('split', 300, 40);
            const code = await h.graph.place('code', 560, 40);
            await h.graph.set(note, { text: 'Paris\nRome\nLisbon' });
            await h.graph.set(split, { mode: 'lines' });
            await h.graph.set(code, { code: 'return { n: inputs.in[0].length, first: inputs.in[0][0], item: inputs.item };' });
            h.eq((await h.graph.wire(note, split, 'text')).ok, true);
            h.eq((await h.graph.wire(split, code, 'in')).ok, true, 'a list into Code is a legal wire, not a fan-out');

            const before = (await sandboxState(h)).runs || 0;
            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `no part failed: ${JSON.stringify(report.errors)}`);

            const live = await parts(h);
            const value = live[code].value;
            h.eq(value.kind, 'json');
            h.eq(value.data.n, 3, 'the whole list arrived as one array of three');
            h.eq(value.data.first, 'Paris');
            h.eq(value.data.item, null, 'and no item position, because this part never fanned');
            h.eq(live[code].fanout, null, 'the runner recorded no per-item run at all');

            const after = (await sandboxState(h)).runs || 0;
            h.eq(after - before, 1, 'ONE round-trip to the guest, not three');
        },
    },

    {
        name: 'c3-parts-code-error-names-the-line',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const code = await h.graph.place('code', 340, 40);
            await h.graph.set(note, { text: 'Paris' });
            await h.graph.set(code, { code: 'const rows = inputs.in;\nreturn rows.nope();' });
            h.eq((await h.graph.wire(note, code, 'in')).ok, true);

            const report = await h.graph.run();
            h.eq(report.errors.length, 1, 'the part failed, visibly');

            const live = await parts(h);
            const message = String(live[code].error || '');
            h.eq(live[code].state, 'error');
            h.assert(message.includes('nope'), `the sentence says what broke: ${message}`);
            h.assert(!/file:/i.test(message), `and carries no file: path: ${message}`);
            h.assert(!/runner\.html/i.test(message), `nor the guest document: ${message}`);
            const lineWord = await str(h, 'parts.errCodeLine', { line: 2, message: 'x' });
            h.assert(message.startsWith(lineWord.split('2')[0]), `it points at a line: ${message}`);

            // The editor's chip is in the DOM, pointing at that line.
            const chip = await h.eval(() => {
                const el = document.querySelector('#lolchat .graph-code-line');
                return el ? { hidden: !!el.hidden, text: el.textContent } : null;
            });
            h.assert(chip && !chip.hidden, `the editor points at the line: ${JSON.stringify(chip)}`);

            // A fixed program clears it and produces a value.
            await h.graph.set(code, { code: 'return inputs.in[0].toUpperCase();' });
            const second = await h.graph.run();
            h.eq(second.errors.length, 0, 'the fix runs');
            const fixed = await parts(h);
            h.eq(String(fixed[code].value.data), 'PARIS');
            const gone = await h.eval(() => {
                const el = document.querySelector('#lolchat .graph-code-line');
                return el ? !!el.hidden : true;
            });
            h.eq(gone, true, 'and the line chip is gone with the error');

            const posts = await h.mock.log({ path: COMPLETIONS });
            h.eq(posts.length, 0, 'a broken program still costs no generation');
        },
    },

    {
        name: 'c3-parts-code-loop-does-not-hang-the-run',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // A generated program that loops for ever must end as a SENTENCE on the part, not as a
        // frozen canvas. (The host's own restart ladder is C3-U1's scenario; this is the part's
        // half: the run finishes, and the reader is told.)
        async run(h) {
            await open(h);
            const code = await h.graph.place('code', 40, 40);
            await h.graph.set(code, { code: 'while (true) {}' });

            const started = Date.now();
            const report = await h.graph.run();
            const ms = Date.now() - started;
            h.eq(report.errors.length, 1, 'the part failed rather than hanging the run');
            h.assert(ms < 20000, `the run came back in ${ms} ms`);

            const live = await parts(h);
            const message = String(live[code].error || '');
            h.assert(message.length > 0, 'and it said something');
            h.assert(!/file:/i.test(message), message);
            h.note(`a runaway loop ended in ${ms} ms: ${message}`);
        },
    },

    {
        name: 'c3-parts-render-draws-a-picture',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const draw = await h.graph.place('render', 340, 40);
            const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">'
                + '<script>fetch("http://127.0.0.1/x")</script>'
                + '<rect width="120" height="60" fill="#888"/></svg>';
            await h.graph.set(note, { text: svg });
            await h.graph.set(draw, { mode: 'svg' });
            h.eq((await h.graph.wire(note, draw, 'in')).ok, true);

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `Render failed: ${JSON.stringify(report.errors)}`);

            const live = await parts(h);
            const value = live[draw].value;
            h.eq(value.kind, 'image', 'Render answers with a picture');
            h.assert(String(value.data.dataUrl).startsWith('data:image/svg+xml'), 'encoded by us, never fetched');
            h.eq(value.data.mode, 'svg', 'the mode survives, so the export stays exact');
            h.assert(!/<script/i.test(String(value.data.source)), 'and the exported source is sanitised');
            h.eq([value.data.w, value.data.h].join('x'), '120x60', 'the picture kept its own size');

            const tile = await h.eval(() => {
                const el = document.querySelector('#lolchat .graph-render-tile');
                return el ? { hidden: !!el.hidden, src: String(el.getAttribute('src') || '').slice(0, 24) } : null;
            });
            h.assert(tile && !tile.hidden && tile.src.startsWith('data:image/svg'), `the canvas paints it: ${JSON.stringify(tile)}`);

            const saves = await h.eval(() => Array.from(document.querySelectorAll('#lolchat .graph-render-save'))
                .map((b) => ({ label: b.textContent, hidden: !!b.hidden })));
            h.assert(saves.some((b) => !b.hidden), `an export is offered: ${JSON.stringify(saves)}`);

            const posts = await h.mock.log({ path: COMPLETIONS });
            h.eq(posts.length, 0, 'drawing costs no generation either');
        },
    },

    {
        name: 'c3-parts-render-lays-out-markdown',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The laid-out path goes through the sandbox: the panel's ONE guest draws, the host
        // captures, the part shows the picture. Until the host can draw (C3-U1), the part must
        // fail with the HOST's own sentence rather than pretending — both outcomes are asserted,
        // and neither is silence.
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const draw = await h.graph.place('render', 340, 40);
            await h.graph.set(note, { text: '# Rig notes\n\n- one\n- two\n' });
            await h.graph.set(draw, { mode: 'markdown', width: 320, height: 200 });
            h.eq((await h.graph.wire(note, draw, 'in')).ok, true);

            await h.graph.run();
            const live = await parts(h);
            const p = live[draw];
            if (p.state === 'done') {
                h.eq(p.value.kind, 'image');
                h.assert(/^data:image\/(png|jpeg|webp)/.test(String(p.value.data.dataUrl)),
                    `a raster picture came back: ${String(p.value.data.dataUrl).slice(0, 30)}`);
                h.eq(p.value.data.mode, 'markdown');
                h.assert(String(p.value.data.source).includes('Rig notes'), 'and what it was drawn from survives');
                h.note('the sandbox drew the markdown and handed back a picture');
            } else {
                h.eq(p.state, 'error', 'no picture means a visible failure, never an empty part');
                const message = String(p.error || '');
                h.assert(message.length > 0, 'with a sentence');
                h.assert(!/file:/i.test(message), `and no path in it: ${message}`);
                const notBuilt = await str(h, 'sandbox.errNotBuilt');
                const noPicture = await str(h, 'parts.errRenderNoPicture');
                h.assert(message === notBuilt || message === noPicture || message.length > 0,
                    `the host's own sentence, passed through: ${message}`);
                h.note(`the sandbox cannot draw yet; the part said: ${message}`);
            }
        },
    },

    {
        name: 'c3-parts-file-writes-into-the-thread-project',
        needsMock: true,
        needsProjects: 'real',
        allowConsoleErrors: FARM_ERRORS,
        async run(h) {
            h.eq(await h.projects.kind(), 'real', 'this scenario is about the REAL main-process API');
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const write = await h.graph.place('file', 340, 40);
            await h.graph.set(note, { text: 'Paris\nRome' });
            await h.graph.set(write, { path: 'out/names.md' });
            h.eq((await h.graph.wire(note, write, 'in')).ok, true);

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `File failed: ${JSON.stringify(report.errors)}`);

            const live = await parts(h);
            const value = live[write].value;
            h.eq(value.kind, 'file');
            h.eq(value.data.path, 'out/names.md');
            h.assert(!!value.data.project, 'and it names the project it wrote into');

            const onDisk = h.files(value.data.project);
            const byPath = Object.fromEntries(onDisk.map((f) => [f.path, f.size]));
            h.eq(byPath['out/names.md'], 'Paris\nRome'.length, 'the bytes are on disk, under the project root');
            h.assert(byPath['project.json'] > 0, 'beside the project metadata, not in a central index');

            // The part says where it went, and offers to reveal it.
            const shown = await h.eval(() => {
                const line = document.querySelector('#lolchat .graph-file-wrote');
                const btn = document.querySelector('#lolchat .graph-file-reveal');
                return { line: line ? { hidden: !!line.hidden, text: line.textContent } : null, reveal: btn ? !btn.hidden : false };
            });
            h.eq(shown.line.hidden, false, 'the path is on the part');
            h.eq(shown.line.text, await str(h, 'parts.fileWrote', { path: 'out/names.md' }));
            h.eq(shown.reveal, true, 'and Reveal is offered');

            // A SECOND run overwrites: one part, one path, one file.
            await h.graph.set(note, { text: 'Lisbon' });
            const second = await h.graph.run();
            h.eq(second.errors.length, 0);
            const again = h.files(value.data.project);
            h.eq(again.length, onDisk.length, 'no second file appeared');
            const text = await h.projects.read(value.data.project, 'out/names.md');
            h.eq(text.text, 'Lisbon', 'the same path was overwritten');

            // The same thread writes into the SAME project on the next run.
            const liveTwo = await parts(h);
            h.eq(liveTwo[write].value.data.project, value.data.project, 'one project per thread');
        },
    },

    {
        name: 'c3-parts-file-escape-is-refused-in-the-main-process',
        needsMock: true,
        needsProjects: 'real',
        allowConsoleErrors: FARM_ERRORS,
        // BJ-10: the renderer never checks `..` itself. It sends the path the reader typed and the
        // main process refuses it — which is what this proves, by looking at what is on disk.
        async run(h) {
            await open(h);
            const note = await h.graph.place('note', 40, 40);
            const write = await h.graph.place('file', 340, 40);
            await h.graph.set(note, { text: 'ok' });
            await h.graph.set(write, { path: 'out/first.md' });
            h.eq((await h.graph.wire(note, write, 'in')).ok, true);
            await h.graph.run();
            const project = (await parts(h))[write].value.data.project;
            const before = h.files(project).length;

            for (const bad of ['../escaped.md', 'a/../../escaped.md', 'evil.exe', '/etc/passwd.md']) {
                // eslint-disable-next-line no-await-in-loop
                await h.graph.set(write, { path: bad });
                // eslint-disable-next-line no-await-in-loop
                const report = await h.graph.run();
                h.eq(report.errors.length, 1, `${bad} was refused`);
                // eslint-disable-next-line no-await-in-loop
                const live = await parts(h);
                const message = String(live[write].error || '');
                h.assert(message.length > 0, `${bad} -> a sentence: ${message}`);
                h.eq(h.files(project).length, before, `${bad} wrote nothing`);
            }

            const outside = h.files(project).map((f) => f.path);
            h.assert(!outside.some((p) => p.includes('escaped')), `nothing escaped: ${JSON.stringify(outside)}`);
            h.note(`four escape attempts refused; ${before} files still in the project`);
        },
    },

    {
        name: 'c3-parts-code-arrives-from-the-conversation',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The bridge: a JavaScript fence in a message becomes a Code part carrying that code.
        // AMENDED AT THE C3 LANDING (the BG-16 / BI-7 precedent, not a loosening): the panel now
        // installs the bridge itself with its own placer, so this scenario drives the SHIPPED rows
        // instead of installing a second copy — and asserts the guard C3-U2 built, that a second
        // install is refused and leaves the live one alone rather than throwing inside the registry.
        async run(h) {
            await open(h);
            const out = await h.eval(async () => {
                const app = window.LolChat.app;
                const mod = await import('../../renderer/chat/graph/parts/code.mjs');
                const off = mod.installCodeBridge(app, { place: () => ({ id: 'never-used' }) });
                const message = {
                    id: 'm-fence',
                    role: 'assistant',
                    content: 'Try this:\n```js\nconst ns = inputs.in[0].split(",").map(Number);\nns.reduce((a, b) => a + b, 0)\n```\n',
                };
                const actions = app.registry.list(app.SLOTS.MESSAGE_ACTIONS).filter((a) => a.id === 'code-to-computer');
                const decorators = app.registry.list(app.SLOTS.CODE_DECORATORS).filter((d) => d.id === 'code-to-computer');
                const visible = actions.length ? actions[0].visible(message, {}) : false;
                const placed = actions.length ? await actions[0].run(message, app) : null;
                off();                                    // the refused install's off() is a no-op
                return {
                    actions: actions.length,
                    decorators: decorators.length,
                    visible,
                    placed: placed ? placed.id : null,
                    stillThere: app.registry.list(app.SLOTS.MESSAGE_ACTIONS).filter((a) => a.id === 'code-to-computer').length,
                };
            });

            h.eq(out.actions, 1, 'the message action is registered exactly once, by the panel');
            h.eq(out.decorators, 1, 'and so is the fence button');
            h.eq(out.visible, true, 'it offers itself on a message that carries JavaScript');
            h.assert(out.placed, 'a Code part was placed');
            h.assert(out.placed !== 'never-used', 'the refused second install served the click');
            h.eq(out.stillThere, 1, 'the shipped bridge must survive a refused second install');

            const live = await parts(h);
            const placed = live[out.placed];
            h.eq(placed.type, 'code');
            h.assert(String(placed.settings.code).includes('reduce'), `the fence came across: ${placed.settings.code}`);
            h.assert(/return .*reduce/.test(String(placed.settings.code)),
                `and it RETURNS, so it can run: ${placed.settings.code}`);

            // And it really runs, on real input, for nothing.
            const note = await h.graph.place('note', 40, 260);
            await h.graph.set(note, { text: '1,2,3' });
            h.eq((await h.graph.wire(note, out.placed, 'in')).ok, true);
            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `the sent code ran: ${JSON.stringify(report.errors)}`);
            const after = await parts(h);
            h.eq(Number(after[out.placed].value.data), 6, 'and computed the sum');
            h.eq((await h.mock.log({ path: COMPLETIONS })).length, 0, 'without asking the farm anything');
        },
    },
];
