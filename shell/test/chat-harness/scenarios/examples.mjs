// @ts-check
// The two worked examples in docs/examples/, against the real app and the real mock farm.
//
// These files are the ones the tutorial (docs/LOLCHAT_COMPUTER_TUTORIAL.md) tells the reader to
// import, so "it probably works" is not good enough. Each scenario below takes the file OFF DISK,
// puts it through the SHIPPED import path (canvas.importText, the same function the file picker
// and the drop handler call), asserts the graph arrived whole — every part, every wire, every
// settings key — and then RUNS it.
//
// What each one proves that a unit test cannot:
//   palette-check  — the model's answer really becomes numbers a deterministic Code part computed,
//                    a Render tile the canvas painted, and bytes on disk inside the thread's own
//                    scratch project. One generation for seven parts.
//   fanout-pitches — one Run really leaves the window as SIX completions, one per line, each about
//                    a different topic, and they really rejoin into one numbered file.
//
// The files ship with `model: ''` (Automatic), which is what a reader wants on a real farm. The
// mock has no "automatic" that answers usefully, so each scenario PINS a mock model after the
// import has been asserted — the import assertions are about the file, the run is about the
// engine, and pinning between them keeps the two honest.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES = path.join(HERE, '..', '..', '..', '..', 'docs', 'examples');

const COMPLETIONS = '/v1/chat/completions';

/** Network noise the farm's own error paths make in the console. */
const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** @param {string} name @returns {string} the example file's text */
const exampleText = (name) => fs.readFileSync(path.join(EXAMPLES, name), 'utf8');

/** Completion POSTs the mock has seen, newest last. */
const posts = (/** @type {any} */ h, /** @type {string} */ model) =>
    h.mock.log(model ? { path: COMPLETIONS, model } : { path: COMPLETIONS });

/** The last user message of one recorded request body. */
const userText = (/** @type {any} */ entry) => {
    const messages = (entry && entry.body && entry.body.messages) || [];
    const last = messages[messages.length - 1];
    return last ? String(last.content) : '';
};

/** The live parts, by id — off the DOC, where the runner writes value/state/error. */
const parts = async (/** @type {any} */ h) => {
    const doc = await h.graph.doc();
    /** @type {Record<string, any>} */ const out = {};
    for (const p of doc.parts) out[p.id] = p;
    return out;
};

/** The first part of a type, off the live doc. */
const firstOf = async (/** @type {any} */ h, /** @type {string} */ type) => {
    const doc = await h.graph.doc();
    const found = doc.parts.find((/** @type {any} */ p) => p.type === type);
    if (!found) throw new Error(`no ${type} part on the canvas`);
    return found;
};

/** A thread, then the Computer panel open on it. */
async function open(/** @type {any} */ h) {
    await h.submit('a thread to try the examples in');
    await h.waitReply();
    await h.eval(async () => {
        const app = window.LolChat.app;
        const rows = await app.repo.listThreads();
        return app.controller.selectThread(rows[0].id);
    });
    await h.mock.reset();                       // every count below is about the GRAPH
    const state = await h.graph.open();
    h.eq(state.panel, 'computer', 'the Computer panel is the one the rail opened');
    await h.waitFor(() => (window.LolChat.debug.computer.doc().threadId ? true : null));
}

/**
 * Import one example through the shipped path and assert NOTHING was dropped: the same part types
 * in the same order, the same settings key for key, and the same wires once the ids are re-minted.
 * @param {any} h @param {string} name
 */
async function importExample(h, name) {
    const text = exampleText(name);
    const file = JSON.parse(text);
    const report = await h.graph.call('importText', text, { confirm: false });
    h.eq(report.ok, true, `${name} imported: ${report.message}`);
    h.eq(report.errors.length, 0, `nothing was dropped: ${JSON.stringify(report.errors)}`);
    h.eq(report.parts, file.parts.length, `all ${file.parts.length} parts arrived`);
    h.eq(report.wires, file.wires.length, `all ${file.wires.length} wires arrived`);

    const doc = await h.graph.doc();
    h.eq(doc.parts.length, file.parts.length, 'and the canvas really holds them');
    h.eq(doc.wires.length, file.wires.length);
    h.eq(doc.parts.map((/** @type {any} */ p) => p.type).join(','),
        file.parts.map((/** @type {any} */ p) => p.type).join(','),
        'the same parts, in the same order');

    // Ids are re-minted on import by design, so the wires are compared through the mapping.
    const id = new Map(file.parts.map((/** @type {any} */ p, /** @type {number} */ i) => [p.id, doc.parts[i].id]));
    const want = file.wires.map((/** @type {any} */ w) => `${id.get(w.from)}>${id.get(w.to)}.${w.port}`).sort().join('|');
    const got = doc.wires.map((/** @type {any} */ w) => `${w.from}>${w.to}.${w.port}`).sort().join('|');
    h.eq(got, want, 'every wire connects the same two ports it did in the file');

    file.parts.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
        for (const key of Object.keys(p.settings || {})) {
            h.eq(JSON.stringify(doc.parts[i].settings[key]), JSON.stringify(p.settings[key]),
                `${p.type}.${key} survived the import`);
        }
    });

    // Every part comes in ready to run, not pretending it already did.
    for (const p of doc.parts) h.assert(p.state === 'idle' || p.state === 'stale', `${p.type} arrived ${p.state}`);
    return doc;
}

export default [
    {
        name: 'examples-palette-check',
        needsMock: true,
        needsProjects: 'real',
        allowConsoleErrors: FARM_ERRORS,
        // The flagship: the model judges, JavaScript checks. One generation, three deterministic
        // computes, a picture on the canvas and a file on disk.
        async run(h) {
            h.eq(await h.projects.kind(), 'real', 'this scenario writes REAL bytes');
            await open(h);
            await importExample(h, 'palette-check.lolgraph.json');

            const ask = await firstOf(h, 'ask');
            h.eq(ask.settings.shape, 'json', 'the example asks for a structured answer');
            h.eq(ask.settings.model, '', 'and ships on Automatic, as a reader wants on a real farm');
            h.assert(JSON.parse(ask.settings.schema).required.includes('palette'),
                'its schema really asks for a palette');
            await h.graph.set(ask.id, { model: 'mock-studio-json' });

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `a part failed: ${JSON.stringify(report.errors)}`);
            h.eq(report.ran, 7, 'all seven parts ran');

            // ONE generation for the whole graph: the three Code parts and the Render cost nothing.
            const log = await posts(h);
            h.eq(log.length, 1, `exactly one completion left the window, got ${log.length}`);
            h.assert(userText(log[0]).includes('Atelier Num'), 'and it carried the brief from the Note');

            const live = await parts(h);
            const byType = (/** @type {string} */ type) => Object.values(live).filter((/** @type {any} */ p) => p.type === type);

            // The contrast part: real numbers, computed in the sandbox.
            const codes = byType('code');
            h.eq(codes.length, 3, 'three Code parts');
            for (const c of codes) h.eq(c.state, 'done', `a Code part failed: ${c.error}`);
            const contrast = codes.find((/** @type {any} */ c) => c.value && c.value.kind === 'json'
                && c.value.data && Array.isArray(c.value.data.rows));
            h.assert(!!contrast, 'the first Code part produced a contrast report');
            h.eq(contrast.value.data.threshold, 4.5, 'against the WCAG AA threshold');
            h.assert(contrast.value.data.rows.length > 0, 'with a row per colour the model proposed');
            h.assert(typeof contrast.value.data.table === 'string' && contrast.value.data.table.startsWith('| Name |'),
                'and a table a person can read');
            // The mock answers a schema-shaped instance, not real hex — which is exactly the case
            // the maths has to survive: it FLAGS what it cannot read instead of inventing a number.
            for (const row of contrast.value.data.rows) {
                h.eq(typeof row.passes, 'boolean', 'every row has a verdict');
                if (row.valid) {
                    h.assert(row.onBlack >= 1 && row.onBlack <= 21, `a real ratio: ${row.onBlack}`);
                    h.assert(row.onWhite >= 1 && row.onWhite <= 21, `a real ratio: ${row.onWhite}`);
                } else {
                    h.assert(String(row.note).length > 0, 'and an unreadable colour says so');
                }
            }

            // The Render tile: a picture the canvas really painted.
            const [draw] = byType('render');
            h.eq(draw.state, 'done', `Render failed: ${draw.error}`);
            h.eq(draw.value.kind, 'image');
            h.eq(draw.value.data.mode, 'svg');
            h.assert(/^data:image\/svg\+xml/.test(String(draw.value.data.dataUrl)),
                `a vector tile came back: ${String(draw.value.data.dataUrl).slice(0, 30)}`);
            h.assert(String(draw.value.data.source).includes('Palette contrast'),
                'and the sheet it was drawn from is the swatch sheet');
            const painted = await h.eval(() => {
                const img = document.querySelector('#lolchat .graph-part img, #lolchat .graph-part canvas');
                return !!img;
            });
            h.assert(painted, 'the tile is on the canvas, not just in the document');

            // The file: bytes on disk, inside this thread's own scratch project.
            const [wrote] = byType('file');
            h.eq(wrote.state, 'done', `File failed: ${wrote.error}`);
            h.eq(wrote.value.kind, 'file');
            h.eq(wrote.value.data.path, 'out/tokens.css');
            h.assert(!!wrote.value.data.project, 'and it names the project it wrote into');
            const onDisk = await h.projects.read(wrote.value.data.project, 'out/tokens.css');
            h.assert(String(onDisk.text).includes(':root {'), `a :root block was written: ${String(onDisk.text).slice(0, 80)}`);
            h.assert(String(onDisk.text).includes('colours checked'), 'with the count it checked in the header');

            // Re-running spends nothing: every part is up to date.
            const again = await h.graph.run();
            h.eq(again.ran, 0, 'a second Run recomputes nothing');
            h.eq((await posts(h)).length, 1, 'and spends no second generation');

            // Editing the brief marks the WHOLE diamond stale — the contrast part, both formatters
            // and the two ends. This is the claim the tutorial makes about re-running, through a
            // graph that forks and does not re-join.
            const note = await firstOf(h, 'note');
            await h.graph.set(note.id, { text: `${note.settings.text}\nIt also needs a warning colour.` });
            const stale = (await h.graph.doc()).parts.filter((/** @type {any} */ p) => p.state === 'stale');
            h.eq(stale.length, 7, `every part downstream of the Note is stale, got ${stale.map((/** @type {any} */ p) => p.type).join(',')}`);
            const third = await h.graph.run();
            h.eq(third.errors.length, 0, `the re-run failed: ${JSON.stringify(third.errors)}`);
            h.eq(third.ran, 7, 'and it really recomputed all seven');
            h.eq((await posts(h)).length, 2, 'for exactly one more generation');
        },
    },

    {
        name: 'examples-fanout-pitches',
        needsMock: true,
        needsProjects: 'real',
        allowConsoleErrors: FARM_ERRORS,
        // The fan-out demo: six lines in, six generations out, one file back.
        async run(h) {
            h.eq(await h.projects.kind(), 'real', 'this scenario writes REAL bytes');
            await open(h);
            const doc = await importExample(h, 'fanout-pitches.lolgraph.json');

            const note = doc.parts.find((/** @type {any} */ p) => p.type === 'note');
            const topics = String(note.settings.text).split('\n').filter(Boolean);
            h.eq(topics.length, 6, 'the Note carries six topics, one per line');

            const ask = await firstOf(h, 'ask');
            h.eq(ask.settings.model, '', 'the example ships on Automatic');
            // mock-item answers with the last line of the last user message, which is how this test
            // tells "six calls" apart from "six calls about the same thing".
            await h.graph.set(ask.id, { model: 'mock-item', instruction: '' });

            const report = await h.graph.run();
            h.eq(report.errors.length, 0, `a part failed: ${JSON.stringify(report.errors)}`);
            h.assert(!report.capped, `six is well under the 50-generation cap: ${JSON.stringify(report.capped)}`);

            const log = await posts(h, 'mock-item');
            h.eq(log.length, 6, `exactly six completions left the window, got ${log.length}`);
            const asked = log.map((/** @type {any} */ e) => {
                const lines = userText(e).split('\n').map((/** @type {string} */ l) => l.trim()).filter(Boolean);
                return lines[lines.length - 1];
            }).sort();
            h.eq(asked.join('|'), [...topics].sort().join('|'),
                'one request per topic, each about a different one');

            const live = await parts(h);
            const askLive = live[ask.id];
            h.eq(askLive.state, 'done');
            h.eq(askLive.value.kind, 'list', 'the fan produced a list');
            h.eq(askLive.value.data.length, 6, 'of the same length as the input');
            h.eq(askLive.fanout.n, 6, 'and the part counted six items');
            h.eq(askLive.fanout.ok, 6, 'all of which succeeded');
            h.eq(askLive.fanout.failed, 0);
            h.assert(askLive.stats && askLive.stats.calls === 6, `six calls on the cost line, got ${JSON.stringify(askLive.stats)}`);

            const collect = Object.values(live).find((/** @type {any} */ p) => p.type === 'collect');
            h.eq(collect.state, 'done');
            h.assert(String(collect.value.data).startsWith('1. '), 'Collect numbered them');
            h.assert(String(collect.value.data).includes('6. '), 'all six of them');

            const wrote = Object.values(live).find((/** @type {any} */ p) => p.type === 'file');
            h.eq(wrote.state, 'done', `File failed: ${wrote.error}`);
            h.eq(wrote.value.data.path, 'out/pitches.md');
            const onDisk = await h.projects.read(wrote.value.data.project, 'out/pitches.md');
            for (const topic of topics) {
                h.assert(String(onDisk.text).includes(topic), `the file carries "${topic.slice(0, 30)}…"`);
            }
        },
    },
];
