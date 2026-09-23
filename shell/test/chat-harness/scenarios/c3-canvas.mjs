// @ts-check
// C3-U3 in the real browser: the sharing story and the layout button (spec §4/§5, plan §2.6 BJ-17).
//
// The unit tests (graph-tidy, graph-serialize) prove the arithmetic — the layering, the format, the
// re-minted ids. Only these scenarios can prove the half that is not arithmetic:
//
//   - export → import → THE SAME PROGRAM, through the shipped buttons and the shipped module, with
//     nothing about this machine in the file (§5: no thread id, no farm address, no key);
//   - an import into a canvas that already has parts on it ASKS FIRST, and when it goes ahead it is
//     ONE undo entry — the whole file back, not a part at a time;
//   - a file that is not a graph, a file that is not JSON at all, and a file from a NEWER version
//     each get their own sentence rather than a console error;
//   - an import that succeeds but could not keep everything SAYS what it dropped, in words;
//   - a `.lolgraph.json` DROPPED on the canvas opens there, and the drop does not reach the
//     composer's guard as an attachment;
//   - tidy moves parts and only parts, is one undo entry, is stable on a second press, and is
//     NEVER automatic: a graph that was built, wired and re-rendered has not moved a pixel until
//     somebody presses the button.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** Fail loudly when the Computer was faked — a green run would otherwise mean nothing. */
const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    if (failed.host) throw new Error(`C3-U3 needs the REAL computer/host.mjs: ${failed.host.error}`);
    return true;
});

/** A string as the page itself resolves it, so a test never re-types an English sentence. */
const str = (/** @type {any} */ h, /** @type {string} */ key, /** @type {any} */ vars) =>
    h.eval((a) => window.LolChat.app.t(a.key, a.vars || undefined), { key, vars: vars || null });

/** A thread, then the Computer panel open on it. */
async function open(/** @type {any} */ h) {
    await requireReal(h);
    await h.submit('a thread to share a program from');
    await h.waitReply();
    const state = await h.graph.open();
    h.eq(state.computer, true, 'the rail opened the Computer');
    await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));
}

/** Note → Split → Ask → Collect, at deliberately scattered coordinates. */
async function build(/** @type {any} */ h) {
    const note = await h.graph.place('note', 640, 430);
    const split = await h.graph.place('split', 120, 90);
    const ask = await h.graph.place('ask', 900, 220);
    const collect = await h.graph.place('collect', 330, 660);
    await h.graph.set(note, { text: 'apple\nbanana\ncherry' });
    await h.graph.set(split, { mode: 'lines' });
    await h.graph.set(ask, { instruction: 'name a colour', model: 'mock-item' });
    await h.graph.set(collect, { mode: 'numbered' });
    h.eq((await h.graph.wire(note, split, 'text')).ok, true, 'Note feeds Split');
    h.eq((await h.graph.wire(split, ask, 'in')).ok, true, 'Split feeds Ask');
    h.eq((await h.graph.wire(ask, collect, 'items')).ok, true, 'Ask feeds Collect');
    return { note, split, ask, collect };
}

/** The graph as a SHAPE: no ids, so two documents can be compared across an import. */
async function shape(/** @type {any} */ h) {
    return h.eval(() => {
        const doc = window.LolComputer.debug.computer.doc();
        const type = (/** @type {string} */ id) => {
            const p = doc.parts.find((/** @type {any} */ q) => q.id === id);
            return p ? p.type : '?';
        };
        return {
            parts: doc.parts.map((/** @type {any} */ p) => ({ type: p.type, settings: p.settings })),
            wires: doc.wires.map((/** @type {any} */ w) => `${type(w.from)}->${type(w.to)}.${w.port}`).sort(),
            ids: doc.parts.map((/** @type {any} */ p) => p.id),
        };
    });
}

/** Every part's position, by id. */
const places = (/** @type {any} */ h) => h.eval(() => {
    /** @type {any} */ const out = {};
    for (const p of window.LolComputer.debug.computer.doc().parts) out[p.id] = `${p.x},${p.y}`;
    return out;
});

/** Empty the canvas without touching undo semantics we are about to measure. */
async function clearGraph(/** @type {any} */ h) {
    const doc = await h.graph.doc();
    if (doc.parts.length) await h.graph.remove(doc.parts.map((/** @type {any} */ p) => p.id));
    h.eq((await h.graph.doc()).parts.length, 0, 'the canvas is empty');
}

/** Start an import WITHOUT awaiting it, so the scenario can answer its dialog. */
const startImport = (/** @type {any} */ h, /** @type {string} */ text) => h.eval((s) => {
    /** @type {any} */ (window).__c3import = window.LolComputer.debug.computer.importText(s);
    return true;
}, text);
const awaitImport = (/** @type {any} */ h) => h.eval(() => /** @type {any} */ (window).__c3import);

const dialogOpen = (/** @type {any} */ h) => h.waitFor(() => {
    const d = document.querySelector('dialog.chat-dialog');
    return d ? { body: (d.querySelector('.chat-dialog-text') || { textContent: '' }).textContent } : null;
});

export default [
    {
        name: 'c3-canvas-export-import-round-trip',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The sharing story end to end: what comes out of Export is what goes back in, and what
        // goes back in is the same PROGRAM with none of this machine in it.
        async run(h) {
            await open(h);
            await build(h);
            const before = await shape(h);

            const text = await h.graph.call('exportText', { values: false });
            h.assert(typeof text === 'string' && text.length > 50, 'the export is text');
            const file = JSON.parse(text);
            // 2 since the K2 kickoff: v2 adds `wire.label` (COMPUTER_PLAN §5.1) and a value's
            // format/lang facets. A v1 file still opens — graph-serialize.test.mjs proves it.
            h.eq(file.lolgraph, 2, 'the format tag names itself and its version');
            h.eq(file.parts.length, 4);
            h.eq(file.wires.length, 3);
            // §5, asserted on the BYTES: a graph file carries the program, never the machine.
            for (const forbidden of ['threadId', 'apiKey', 'Bearer', 'http://', 'https://', 'clientId']) {
                h.eq(text.indexOf(forbidden), -1, `a graph file never carries ${forbidden}`);
            }

            await clearGraph(h);
            const out = await h.graph.call('importText', text);
            h.eq(out.ok, true, JSON.stringify(out));
            h.eq(out.parts, 4, 'four parts came back');
            h.eq(out.wires, 3, 'three wires came back');
            h.eq(out.errors.length, 0, `nothing was dropped: ${JSON.stringify(out.errors)}`);
            h.eq(out.message, await str(h, 'graph.importDone', { n: 4, w: 3 }), 'and it says what it read');

            const after = await shape(h);
            h.eq(JSON.stringify(after.parts), JSON.stringify(before.parts), 'same parts, same settings');
            h.eq(JSON.stringify(after.wires), JSON.stringify(before.wires), 'same wiring');
            h.eq(after.ids.some((/** @type {string} */ id) => before.ids.indexOf(id) >= 0), false,
                'every id was re-minted, so importing the same file twice cannot collide');

            // The DOM agrees with the model: an import that only wrote the document would be a lie.
            // Waited for, not read once: the wire layer paints on the canvas's single rAF, so a
            // bare read here races the frame rather than testing anything (seen failing 1 run in 3).
            const dom = await h.waitFor(() => {
                const svg = document.querySelector('#lolcomputer .graph-wires');
                const parts = document.querySelectorAll('#lolcomputer .graph-part').length;
                const wires = svg ? svg.querySelectorAll('path').length : 0;
                return parts === 4 && wires === 3 ? { parts, wires } : null;
            });
            h.eq(dom.parts, 4, 'four boxes on the canvas');
            h.eq(dom.wires, 3, 'three wires drawn');
        },
    },

    {
        name: 'c3-canvas-export-button-writes-a-file',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The real toolbar path, popover and all — including the choice about cached values, which
        // is a choice because a value is chat text and a picture is a megabyte.
        async run(h) {
            await open(h);
            await build(h);

            await h.eval(() => {
                const menu = document.querySelector('#lolcomputer .graph-export-menu');
                if (!menu || !menu.hidden) throw new Error('the export popover is open before anybody asked');
                return true;
            });
            await h.click('#lolcomputer .graph-export');
            const menu = await h.eval(() => {
                const m = document.querySelector('#lolcomputer .graph-export-menu');
                return {
                    hidden: !m || m.hidden,
                    values: !!(m && m.querySelector('.graph-export-values-input')),
                    expanded: (document.querySelector('#lolcomputer .graph-export') || { getAttribute: () => '' }).getAttribute('aria-expanded'),
                };
            });
            h.eq(menu.hidden, false, 'Export… opens its popover');
            h.eq(menu.values, true, 'and asks whether the cached values go in the file');
            h.eq(menu.expanded, 'true', 'aria-expanded follows it');

            await h.click('#lolcomputer .graph-export-save');
            const said = await h.waitFor(() => {
                const live = document.querySelector('#lolcomputer .graph-live');
                const text = live ? live.textContent || '' : '';
                return /lolgraph\.json/.test(text) ? text : null;
            });
            h.assert(/\.lolgraph\.json/.test(said), `the live region names the file it saved: ${said}`);

            const got = h.downloads();
            if (got.length) h.note(`the export reached the filesystem: ${got[got.length - 1].name} (${got[got.length - 1].bytes} bytes)`);
            else h.note('no will-download fired for the object-URL anchor; the live region is the assertion');

            const menuAfter = await h.eval(() => {
                const m = document.querySelector('#lolcomputer .graph-export-menu');
                return !m || m.hidden;
            });
            h.eq(menuAfter, true, 'and the popover closes behind it');

            // The choice is REAL, not decoration: run the graph, then compare the two files. A
            // cached value is chat text — it travels only when somebody ticks the box (spec §5).
            const report = await h.graph.run({});
            h.eq(report.errors.length, 0, JSON.stringify(report.errors));
            const withValues = await h.graph.call('exportText', { values: true });
            const without = await h.graph.call('exportText', { values: false });
            h.assert(withValues.length > without.length, 'the file with values in it is the bigger one');
            h.assert(withValues.indexOf('"value"') >= 0, 'and it really carries them');
            h.eq(without.indexOf('"value"'), -1, 'while the default carries the program alone');
        },
    },

    {
        name: 'c3-canvas-import-asks-before-it-replaces',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // A canvas with work on it is not overwritten by a drop. And when the reader says yes, the
        // whole file is ONE undo entry — not four parts and three wires to undo one at a time.
        async run(h) {
            await open(h);
            const ids = await build(h);
            const text = await h.graph.call('exportText', {});
            const before = await places(h);
            const undoBefore = (await h.graph.state()).undo.past;

            // 1. Cancel: nothing changes, and it says so.
            await startImport(h, text);
            const dlg = await dialogOpen(h);
            h.assert(/4/.test(dlg.body), `the question names what is at stake: ${JSON.stringify(dlg.body)}`);
            await h.click('.chat-dialog-cancel');
            const cancelled = await awaitImport(h);
            h.eq(cancelled.ok, false, 'a cancelled import imports nothing');
            h.eq(cancelled.cancelled, true);
            h.eq(JSON.stringify(await places(h)), JSON.stringify(before), 'not one part moved');
            h.eq((await h.graph.state()).said, await str(h, 'graph.importCancelled'), 'and the reader is told');
            h.eq((await h.graph.state()).undo.past, undoBefore, 'a cancelled import is not an undo entry');

            // 2. Go ahead: one entry, and one undo takes the whole file back.
            await startImport(h, text);
            await dialogOpen(h);
            await h.click('.chat-dialog-ok');
            const done = await awaitImport(h);
            h.eq(done.ok, true, JSON.stringify(done));
            h.eq((await h.graph.doc()).parts.length, 4, 'the imported graph replaced the old one');
            h.eq((await h.graph.state()).undo.past, undoBefore + 1, 'the whole file is ONE undo entry');

            h.eq(await h.graph.undo(), true);
            const back = await h.graph.doc();
            h.eq(back.parts.length, 4);
            h.eq(back.parts.map((/** @type {any} */ p) => p.id).sort().join(','),
                Object.keys(before).sort().join(','), 'one undo restored the ORIGINAL parts, ids and all');
            h.eq(JSON.stringify(await places(h)), JSON.stringify(before), 'exactly where they were');
            void ids;
        },
    },

    {
        name: 'c3-canvas-import-refusals-and-losses',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Four ways a file can disappoint, four sentences. None of them is a console error and
        // none of them leaves the canvas half-written.
        async run(h) {
            await open(h);
            await build(h);
            await clearGraph(h);                        // an empty canvas asks no questions

            const notJson = await h.graph.call('importText', 'this is not a file, it is a sentence');
            h.eq(notJson.ok, false);
            h.eq(notJson.message, await str(h, 'graph.errImportUnreadable'), 'a file that is not JSON');

            const notGraph = await h.graph.call('importText', JSON.stringify({ chats: [], version: 2 }));
            h.eq(notGraph.ok, false);
            h.eq(notGraph.message, await str(h, 'graph.errImportNotGraph'), 'a JSON file that is not a graph');

            const newer = await h.graph.call('importText', JSON.stringify({ lolgraph: 99, parts: [], wires: [] }));
            h.eq(newer.ok, false);
            h.eq(newer.message, await str(h, 'graph.errImportVersion'), 'a graph from a newer LOL Chat');
            h.eq((await h.graph.doc()).parts.length, 0, 'not one refusal wrote anything to the canvas');

            // A file this build can only PARTLY read: one part type we do not have, and the wire
            // that fed it. It imports as much as runs, and says what it left behind.
            const partial = JSON.stringify({
                lolgraph: 1,
                title: 'from a later version',
                settings: {},
                parts: [
                    { id: 'a', type: 'note', x: 40, y: 40, settings: { text: 'hello' } },
                    { id: 'b', type: 'hologram', x: 300, y: 40, settings: {} },
                ],
                wires: [{ from: 'a', to: 'b', port: 'in' }],
            });
            const out = await h.graph.call('importText', partial);
            h.eq(out.ok, true, 'a file we can partly read is not a refusal');
            h.eq(out.parts, 1, 'the part this build has came in');
            h.eq(out.wires, 0, 'the wire that had nowhere to go did not');
            h.assert(out.errors.length >= 2, `it reports every loss: ${JSON.stringify(out.errors)}`);
            const unknown = await str(h, 'graph.dropPartUnknown');
            h.assert(out.message.indexOf(unknown) >= 0,
                `the report is in words, not reason codes: ${JSON.stringify(out.message)}`);
            h.eq((await h.graph.state()).said, out.message, 'and the live region says the same thing');
        },
    },

    {
        name: 'c3-canvas-drop-a-graph-file',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // "Import drops it onto any thread" (spec §5), taken literally. The overlay only exists
        // while a drag carrying files is over the canvas, and the drop is handled HERE — the
        // composer's document-level guard never sees it as something to attach.
        async run(h) {
            await open(h);
            await build(h);
            const before = await shape(h);
            const text = await h.graph.call('exportText', {});
            await clearGraph(h);

            h.eq(await h.eval(() => {
                const el = document.querySelector('#lolcomputer .graph-drop');
                return !el || el.hidden;
            }), true, 'the drop overlay is invisible at rest');

            const base64 = Buffer.from(text, 'utf8').toString('base64');
            const res = await h.drop('#lolcomputer .graph-canvas', [
                { name: 'shared.lolgraph.json', mime: 'application/json', base64 },
            ]);
            h.eq(res.files, 1, 'the drag really carried a file');
            h.eq(res.defaultPrevented, true, 'the canvas handled the drop rather than the browser');

            await h.waitFor(() => (window.LolComputer.debug.computer.doc().parts.length === 4 ? true : null));
            const after = await shape(h);
            h.eq(JSON.stringify(after.parts), JSON.stringify(before.parts), 'the dropped file opened here');
            h.eq(await h.eval(() => {
                const el = document.querySelector('#lolcomputer .graph-drop');
                return !el || el.hidden;
            }), true, 'and the overlay went away behind it');

            // The composer is untouched: the graph file was not read as a message or an attachment.
            const composer = await h.eval(() => {
                const input = /** @type {any} */ (document.querySelector('#chat-input'));
                return { value: input ? String(input.value || '') : '', attachments: document.querySelectorAll('#lolchat .chat-attachment').length };
            });
            h.eq(composer.value, '', 'the message box is still empty');
            h.eq(composer.attachments, 0, 'and nothing was attached to the conversation');
        },
    },

    {
        name: 'c3-canvas-tidy',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // Never automatic, one undo, stable. A layout button that moved things on its own would be
        // the single most annoying thing in the panel.
        async run(h) {
            await open(h);
            const ids = await build(h);
            const placed = await places(h);

            // NEVER AUTOMATIC: the graph has been built, wired, re-rendered and selected, and every
            // part is still exactly where it was put.
            await h.graph.select([ids.note, ids.ask]);
            await h.graph.dom();
            h.eq(JSON.stringify(await places(h)), JSON.stringify(placed),
                'building and wiring a graph never moves anything by itself');

            const undoBefore = (await h.graph.state()).undo.past;
            await h.click('#lolcomputer .graph-tidy');
            await h.waitFor(() => {
                const live = document.querySelector('#lolcomputer .graph-live');
                return live && /\d/.test(live.textContent || '') ? true : null;
            });
            const moved = await places(h);
            h.eq(Object.keys(moved).length, 4, 'tidy adds and removes nothing');
            h.eq((await h.graph.doc()).wires.length, 3, 'and rewires nothing');
            h.eq(JSON.stringify(moved) !== JSON.stringify(placed), true, 'the parts moved');
            h.eq((await h.graph.state()).said, await str(h, 'graph.tidyMoved', { n: 4 }), 'it says how many moved');
            h.eq((await h.graph.state()).undo.past, undoBefore + 1, 'one press is ONE undo entry');

            // Left to right, in wire order.
            const xs = await h.eval((a) => {
                const doc = window.LolComputer.debug.computer.doc();
                /** @type {any} */ const by = {};
                for (const p of doc.parts) by[p.id] = p.x;
                return [by[a.note], by[a.split], by[a.ask], by[a.collect]];
            }, ids);
            h.assert(xs[0] < xs[1] && xs[1] < xs[2] && xs[2] < xs[3],
                `the graph reads left to right after tidy: ${xs.join(' < ')}`);

            // Stable: a second press moves nothing and is not an undo entry.
            await h.click('#lolcomputer .graph-tidy');
            h.eq((await h.graph.state()).said, await str(h, 'graph.tidyNothing'), 'a tidy graph says so');
            h.eq(JSON.stringify(await places(h)), JSON.stringify(moved), 'and nothing moved again');
            h.eq((await h.graph.state()).undo.past, undoBefore + 1, 'nor was anything pushed onto undo');

            h.eq(await h.graph.undo(), true);
            h.eq(JSON.stringify(await places(h)), JSON.stringify(placed), 'one undo puts the graph back');
        },
    },

    {
        name: 'c3-canvas-tidy-thirty-parts',
        needsMock: true,
        allowConsoleErrors: FARM_ERRORS,
        // The size a real program reaches. Ten chains of three, scattered: tidy lays them out in
        // three columns, is stable on a second press, and is still ONE undo entry.
        async run(h) {
            await open(h);
            /** @type {string[]} */ const all = [];
            for (let i = 0; i < 10; i++) {
                const note = await h.graph.place('note', 700 - i * 13, (i * 97) % 500);
                const split = await h.graph.place('split', 40 + ((i * 31) % 300), 600 - i * 7);
                const ask = await h.graph.place('ask', (i * 71) % 900, (i * 53) % 900);
                h.eq((await h.graph.wire(note, split, 'text')).ok, true);
                h.eq((await h.graph.wire(split, ask, 'in')).ok, true);
                all.push(note, split, ask);
            }
            h.eq((await h.graph.doc()).parts.length, 30, 'thirty parts on the canvas');
            const placed = await places(h);
            const undoBefore = (await h.graph.state()).undo.past;

            const t0 = Date.now();
            const moved = await h.graph.call('tidy');
            const ms = Date.now() - t0;
            h.eq(moved, 30, 'every part in the scatter had somewhere better to be');
            h.note(`tidy over 30 parts: ${ms} ms (round trip through the debug door)`);

            const after = await places(h);
            const columns = new Set(Object.values(after).map((/** @type {any} */ s) => String(s).split(',')[0]));
            h.eq(columns.size, 3, `three columns, got ${Array.from(columns).join(' ')}`);
            h.eq(new Set(Object.values(after)).size, 30, 'no two parts land on the same spot');
            h.eq((await h.graph.doc()).wires.length, 20, 'twenty wires, all of them still there');

            h.eq(await h.graph.call('tidy'), 0, 'a second press on a tidy 30-part graph moves nothing');
            h.eq((await h.graph.state()).undo.past, undoBefore + 1, 'and the whole layout is ONE undo entry');
            h.eq(await h.graph.undo(), true);
            h.eq(JSON.stringify(await places(h)), JSON.stringify(placed), 'one undo puts all thirty back');
        },
    },
];
