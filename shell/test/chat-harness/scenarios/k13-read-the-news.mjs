// @ts-check
// Ecosystem plan v2, P1a: the Fetch box and the "Read the news" template, on the mock farm.
//   1. The template opens from the Learn shelf, runs from the copy it ships with when the web is
//      unreachable (and SAYS so), costs exactly its two generations, and ends in an SVG chart whose
//      numbers come from the Code boxes.
//   2. A Fetch box reads a live address (a fixture server started here, on an ephemeral port — the
//      harness's io.js allows loopback for exactly this), and refuses the farm's ports and a
//      non-web scheme with sentences a person can act on.
import http from 'node:http';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const completions = async (/** @type {any} */ h) => h.mock.log({ path: '/v1/chat/completions' });

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}

/** Wait for the runner to finish and every listed box to have settled. */
async function settle(/** @type {any} */ h, /** @type {string[]} */ ids) {
    await h.waitFor((want) => {
        const dbg = window.LolComputer.debug.computer;
        const d = dbg.doc();
        return !dbg.running() && want.every((id) => { const p = d.parts.find((x) => x.id === id); return p && (p.state === 'done' || p.state === 'error'); }) ? true : null;
    }, { timeout: 90000, args: [ids] });
    return h.computer.doc();
}

const idOf = (/** @type {any} */ doc, /** @type {string} */ type, /** @type {number} */ nth = 0) => doc.parts.filter((/** @type {any} */ p) => p.type === type)[nth].id;

export default [
    {
        name: 'k13-read-the-news-runs-from-its-offline-copy-and-draws-an-svg',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await open(h);
            const before = await h.computer.call('docId');
            await h.computer.tutorial.openTemplate('read-the-news');
            await h.waitFor((was) => {
                const id = window.LolComputer.debug.computer.docId();
                const doc = window.LolComputer.debug.computer.doc();
                return id && id !== was && doc && doc.parts.some((p) => p.type === 'fetch') ? id : null;
            }, { timeout: 15000, args: [before] });
            let doc = await h.computer.doc();
            h.eq(doc.title, 'Read the news', 'a new library document, named for the template');
            const src = idOf(doc, 'fetch');
            const asks = doc.parts.filter((/** @type {any} */ p) => p.type === 'ask').map((/** @type {any} */ p) => p.id);
            h.eq(asks.length, 2, 'two thinking boxes: label, then choose the chart');
            const gens = await h.eval(() => (document.querySelector('#lolcomputer .comp-run-gens') || {}).textContent || '');
            h.assert(/\b2\b/.test(gens), `the run bar says what it costs: ${gens}`);

            // No web: a port nothing listens on (the harness allows loopback, so this is a refused
            // connection — a network failure, the one case the last copy may cover).
            await h.computer.set(src, { url: 'http://127.0.0.1:9/front_page.json' });
            for (const id of asks) await h.computer.set(id, { model: 'mock-studio-json' });   // a mock model that honours a schema
            await h.click('#lolcomputer .comp-run-all');
            doc = await settle(h, doc.parts.filter((/** @type {any} */ p) => ['fetch', 'code', 'ask', 'preview'].includes(p.type)).map((/** @type {any} */ p) => p.id));
            const bad = doc.parts.filter((/** @type {any} */ p) => ['fetch', 'code', 'ask', 'preview'].includes(p.type) && p.state !== 'done');
            h.eq(bad.map((/** @type {any} */ p) => `${p.id}: ${p.error}`), [], 'every box ran');

            const face = await h.eval((id) => {
                const el = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-fetch-status`);
                return el ? { text: el.textContent, offline: el.classList.contains('offline') } : null;
            }, src);
            h.assert(face && face.offline && /Offline/.test(face.text), `the Fetch box says it kept the last copy: ${JSON.stringify(face)}`);

            const pick = doc.parts.find((/** @type {any} */ p) => p.type === 'code' && /stories:/.test(p.settings.code));
            h.eq(pick.value.data.stories.length, 30, 'the shipped copy carries the 30 front-page stories');
            const count = doc.parts.find((/** @type {any} */ p) => p.type === 'code' && /byTopic/.test(p.settings.code) && /counted HERE/.test(p.settings.code));
            const total = count.value.data.byTopic.reduce((/** @type {number} */ s, /** @type {any} */ r) => s + r.stories, 0);
            h.eq(total, 30, 'the Code box counted every story once — the counts come from the data');

            const svg = await h.eval((id) => {
                const host = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"]`);
                // The Preview shows a SANITISED svg as an <img src=data:image/svg+xml,…> (no script can run).
                const img = host && host.querySelector('img[src^="data:image/svg+xml"]');
                if (!img) return null;
                const svgText = decodeURIComponent(String(img.getAttribute('src')).slice(String(img.getAttribute('src')).indexOf(',') + 1));
                return { rects: (svgText.match(/<rect/g) || []).length, text: svgText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(-200) };
            }, idOf(doc, 'preview'));
            h.assert(svg && svg.rects >= 2, `the Preview draws the chart as SVG: ${JSON.stringify(svg)}`);
            h.assert(/labels by the model · counts by the code/.test(svg.text), 'the chart says who did what');
            h.eq((await completions(h)).length, 2, 'two generations, as the shelf said');
        },
    },

    {
        name: 'k13-fetch-reads-a-live-address-and-refuses-the-farm-and-non-web-schemes',
        needsMock: true,
        timeoutMs: 60000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const server = http.createServer((req, res) => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ hits: [{ title: 'Fixture story', points: 7, num_comments: 3 }] }));
            });
            await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
            const port = /** @type {any} */ (server.address()).port;
            try {
                await h.fresh();
                await open(h);
                const id = await h.computer.place('fetch', 80, 80);
                await h.computer.set(id, { url: `http://127.0.0.1:${port}/data.json` });
                await h.computer.runFrom(id);
                let p = (await settle(h, [id])).parts.find((/** @type {any} */ x) => x.id === id);
                h.eq(p.state, 'done', `a live GET: ${p.error}`);
                h.eq(p.value, { kind: 'json', data: { hits: [{ title: 'Fixture story', points: 7, num_comments: 3 }] } }, 'JSON in, a JSON value out');
                const face = await h.eval((pid) => (document.querySelector(`#lolcomputer .graph-part[data-id="${pid}"] .graph-fetch-status`) || {}).textContent || '', id);
                h.assert(new RegExp(`200 · 1 KB · 127\\.0\\.0\\.1:${port}`).test(face), `the face says what it read: ${face}`);

                for (const [url, words] of [['http://127.0.0.1:4000/v1/models', /farm’s own ports/], ['file:///C:/Windows/win.ini', /Only http/]]) {
                    await h.computer.set(id, { url });
                    await h.computer.runFrom(id);
                    p = (await settle(h, [id])).parts.find((/** @type {any} */ x) => x.id === id);
                    h.eq(p.state, 'error', `${url} is refused`);
                    h.assert(words.test(String(p.error)), `and says why: ${p.error}`);
                }
            } finally {
                server.close();
            }
        },
    },
];
