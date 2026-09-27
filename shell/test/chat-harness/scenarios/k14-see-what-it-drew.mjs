// @ts-check
// Owner, 2026-09-27: "a svg, threejs or p5js should have an image output a user could route to a
// describe-image node. The goal is for the model to 'see' what it produced and do a feedback loop.
// When the svg code or p5 or threejs is changed by a model the render should refresh."
//   1. A model writes an SVG → the Preview draws it → its IMAGE output reaches a vision Instruction
//      as a PNG (vision models read PNG, not SVG).
//   2. The model then writes DIFFERENT code (▶ on the writer): the Preview redraws it, and the
//      describing model sees the new picture.
//   3. The same for a p5.js sketch, whose picture comes back from the sandbox.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

const SVG_V1 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#bfe3f2"/><circle id="version-one" cx="50" cy="50" r="30" fill="#f2b134"/></svg>';
const SVG_V2 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100" fill="#20304a"/><rect id="version-two" x="90" y="20" width="80" height="60" fill="#e0457b"/></svg>';
const fenced = (code) => 'Here it is:\n\n```svg\n' + code + '\n```';

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}

async function settle(/** @type {any} */ h, /** @type {string[]} */ ids, /** @type {number} */ stamp) {
    await h.waitFor((want, was) => {
        const dbg = window.LolComputer.debug.computer;
        const d = dbg.doc();
        return !dbg.running() && d.updatedAt !== was && want.every((id) => { const p = d.parts.find((x) => x.id === id); return p && (p.state === 'done' || p.state === 'error'); }) ? true : null;
    }, { timeout: 60000, args: [ids, stamp] });
    return h.computer.doc();
}

/** The SVG text the Preview shows right now (it draws a sanitised SVG as a data: img). */
const shownSvg = (/** @type {any} */ h, /** @type {string} */ id) => h.eval((pid) => {
    const img = document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] img[src^="data:image/svg+xml"]`);
    if (!img) return '';
    const src = String(img.getAttribute('src'));
    return decodeURIComponent(src.slice(src.indexOf(',') + 1));
}, id);

export default [
    {
        name: 'k14-an-svg-preview-hands-a-png-to-a-model-and-redraws-when-the-model-rewrites-it',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const writer = await h.computer.place('ask', 60, 60);
            const view = await h.computer.place('preview', 460, 60);
            const eye = await h.computer.place('ask', 900, 60);
            await h.computer.set(writer, { instruction: 'Draw a small SVG picture.', model: 'mock-code' });
            await h.computer.set(view, { mode: 'svg' });
            const describe = await h.eval(() => window.LolComputer.app.t('parts.describeAsk'));
            await h.computer.set(eye, { instruction: describe, model: 'mock-vision-echo' });
            await h.computer.wire(writer, view, 'content');
            await h.computer.wire(view, eye, 'in');

            // 1. The first drawing, seen.
            await h.mock.state({ codeReply: fenced(SVG_V1) });
            let stamp = (await h.computer.doc()).updatedAt;
            await h.click('#lolcomputer .comp-run-all');
            let doc = await settle(h, [writer, view, eye], stamp);
            const p1 = doc.parts.find((/** @type {any} */ p) => p.id === view);
            h.eq(p1.state, 'done', `the Preview drew: ${p1.error}`);
            h.eq(p1.value && p1.value.kind, 'image', 'the Preview hands on an image');
            h.assert(/^data:image\/png;base64,/.test(String(p1.value.data.dataUrl)), 'a PNG, not the SVG: vision models read raster pictures');
            h.assert((await shownSvg(h, view)).includes('version-one'), 'the box shows the first drawing');
            let seen = String(doc.parts.find((/** @type {any} */ p) => p.id === eye).value.data);
            h.assert(/images: 1/.test(seen) && /mimes: image\/png/.test(seen), `the describing model received the picture: ${seen}`);

            // 2. The model rewrites the code: ▶ on the writer re-runs it AND everything after it.
            await h.mock.state({ codeReply: fenced(SVG_V2) });
            stamp = (await h.computer.doc()).updatedAt;
            await h.computer.runFrom(writer);
            doc = await settle(h, [writer, view, eye], stamp);
            h.assert((await shownSvg(h, view)).includes('version-two'), 'the Preview redrew the NEW code');
            h.assert(!(await shownSvg(h, view)).includes('version-one'), 'and the old drawing is gone');
            const p2 = doc.parts.find((/** @type {any} */ p) => p.id === view);
            h.assert(p2.value.data.dataUrl !== p1.value.data.dataUrl, 'the picture it hands on changed too');
            seen = String(doc.parts.find((/** @type {any} */ p) => p.id === eye).value.data);
            h.assert(/images: 1/.test(seen), 'and the describing model looked again');
        },
    },

    {
        name: 'k14-a-p5-preview-hands-its-snapshot-to-a-model',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const view = await h.computer.place('preview', 60, 60);
            const eye = await h.computer.place('ask', 500, 60);
            // The p5 preset's starter sketch draws with no farm at all.
            const starter = await h.eval(() => window.LolComputer.debug.computer.starter ? window.LolComputer.debug.computer.starter('p5') : null);
            await h.computer.set(view, { mode: 'p5', source: starter || 'function setup(){createCanvas(200,100);noLoop();}\nfunction draw(){background(40);fill(240,180,60);circle(100,50,60);}' });
            const describe = await h.eval(() => window.LolComputer.app.t('parts.describeAsk'));
            await h.computer.set(eye, { instruction: describe, model: 'mock-vision-echo' });
            await h.computer.wire(view, eye, 'in');
            const stamp = (await h.computer.doc()).updatedAt;
            await h.click('#lolcomputer .comp-run-all');
            const doc = await settle(h, [view, eye], stamp);
            const p = doc.parts.find((/** @type {any} */ x) => x.id === view);
            h.eq(p.state, 'done', `the sketch drew: ${p.error}`);
            h.eq(p.value && p.value.kind, 'image');
            h.assert(/^data:image\/png;base64,/.test(String(p.value.data.dataUrl)), 'the sandbox snapshot, as a PNG');
            const seen = String(doc.parts.find((/** @type {any} */ x) => x.id === eye).value.data);
            h.assert(/images: 1/.test(seen) && /mimes: image\/png/.test(seen), `the model received the snapshot: ${seen}`);
        },
    },
];
