// @ts-check
// Owner, 2026-09-27: "paste a dataset link and do an analysis of the data" — the Open data box and the
// "Analyse a dataset" template. data.gouv.fr is answered by a fixture on loopback (h.io.map: the harness main
// sends the two data.gouv.fr hosts there; the REAL io.js does the GETs).
//   1. A pasted dataset page link: the box asks exactly the dataset, its files, the profile and the pages,
//      and hands on the table (names without the CSV's byte-order mark); a foreign link is refused in words.
//   2. The template runs offline from the copy it ships with: the page (the model's words, data.gouv.fr's
//      numbers), the chart, and the model's program over the sample; every box done, three generations.
import http from 'node:http';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const RID = '47ac11c2-8a00-46a7-9fa8-9b802643f975';
const DSID = '5de8f397634f4164071119c5';

async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer && window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
}

/** Wait until the runner is idle and every listed box has settled. */
async function settle(/** @type {any} */ h, /** @type {string[]} */ ids) {
    await h.waitFor((want) => {
        const dbg = window.LolComputer.debug.computer;
        const d = dbg.doc();
        return !dbg.running() && want.every((id) => { const p = d.parts.find((x) => x.id === id); return p && (p.state === 'done' || p.state === 'error'); }) ? true : null;
    }, { timeout: 90000, args: [ids] });
    return h.computer.doc();
}

/** A small data.gouv.fr: one dataset, one parsed CSV of 250 rows. Records the paths asked. */
function fixture() {
    /** @type {string[]} */ const asked = [];
    const row = (/** @type {number} */ i) => ({ __id: i, '\uFEFFNom': `Festival ${i}`, Discipline: i % 3 ? 'Musique' : 'Livre' });
    const server = http.createServer((req, res) => {
        const url = String(req.url || '');
        asked.push(url);
        /** @param {any} body */
        const json = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (url === '/site/api/2/datasets/demo-festivals/') return json({ id: DSID, title: 'Demo festivals', organization: { name: 'Ministère de la Culture' }, license: 'lov2', last_update: '2026-09-17T10:00:00', page: 'https://www.data.gouv.fr/datasets/demo-festivals', description: 'A demo.' });
        if (url === `/site/api/2/datasets/${DSID}/resources/?page_size=100`) return json({ data: [{ id: RID, title: 'festivals.csv', format: 'csv', type: 'main', extras: { 'analysis:parsing:parsing_table': 't' } }] });
        if (url === `/tab/api/resources/${RID}/profile/`) {
            return json({ profile: { header: ['\uFEFFNom', 'Discipline'], columns: { Nom: { format: 'string' }, Discipline: { format: 'string' } }, profile: { Nom: { nb_distinct: 250, nb_missing_values: 0 }, Discipline: { nb_distinct: 2, nb_missing_values: 0, tops: [{ value: 'Musique', count: 167 }, { value: 'Livre', count: 83 }] } } } });
        }
        const m = new RegExp(`^/tab/api/resources/${RID}/data/\\?page=(\\d+)&page_size=(\\d+)$`).exec(url);
        if (m) {
            const from = (Number(m[1]) - 1) * Number(m[2]);
            const n = Math.max(0, Math.min(Number(m[2]), 250 - from));
            return json({ data: Array.from({ length: n }, (_, i) => row(from + i + 1)), meta: { page: Number(m[1]), page_size: Number(m[2]), total: 250 }, links: { next: from + n < 250 ? 'next' : null } });
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"message":"Not Found"}');
    });
    return { server, asked };
}

export default [
    {
        name: 'k21-open-data-a-pasted-link-reads-exactly-data-gouv-fr-s-addresses-and-a-foreign-link-is-refused',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            const { server, asked } = fixture();
            await new Promise((r) => server.listen(0, '127.0.0.1', () => r(null)));
            const port = /** @type {any} */ (server.address()).port;
            try {
                await h.fresh();
                h.io.map({ 'https://www.data.gouv.fr/': `http://127.0.0.1:${port}/site/`, 'https://tabular-api.data.gouv.fr/': `http://127.0.0.1:${port}/tab/` });
                await open(h);
                const box = await h.computer.place('opendata', 40, 60);
                await h.computer.set(box, { link: 'https://www.data.gouv.fr/fr/datasets/demo-festivals/', rows: 250 });
                await h.computer.runFrom(box);
                let doc = await settle(h, [box]);
                const p = doc.parts.find((/** @type {any} */ x) => x.id === box);
                h.eq(p.state, 'done', `the box read the dataset: ${p.error}`);
                h.eq(asked, [
                    '/site/api/2/datasets/demo-festivals/',
                    `/site/api/2/datasets/${DSID}/resources/?page_size=100`,
                    `/tab/api/resources/${RID}/profile/`,
                    `/tab/api/resources/${RID}/data/?page=1&page_size=200`,
                    `/tab/api/resources/${RID}/data/?page=2&page_size=200`,
                ], 'exactly the dataset, its files, the profile and two pages');
                const v = p.value.data;
                h.eq([v.total, v.read, v.columns.map((/** @type {any} */ c) => c.name), v.rows[0]], [250, 250, ['Nom', 'Discipline'], { Nom: 'Festival 1', Discipline: 'Musique' }], 'the table, as a person reads it');
                const face = await h.eval((id) => (document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-fetch-status`) || {}).textContent || '', box);
                h.assert(/Demo festivals · 250 rows · 2 columns · read 250/.test(face), `the face says what it read: ${face}`);

                await h.computer.set(box, { link: 'https://example.org/datasets/demo-festivals' });
                await h.computer.runFrom(box);
                doc = await settle(h, [box]);
                const bad = doc.parts.find((/** @type {any} */ x) => x.id === box);
                h.assert(bad.state === 'error' && /not a data\.gouv\.fr link/.test(bad.error), `a foreign link is refused in words: ${bad.error}`);
                h.eq(asked.length, 5, 'and nothing was asked for it');
            } finally {
                h.io.map(null);
                server.close();
            }
        },
    },
    {
        name: 'k21-analyse-a-dataset-runs-offline-from-its-copy-the-page-the-chart-and-the-model-s-program',
        needsMock: true,
        timeoutMs: 150000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            try {
                await h.fresh();
                // No web: data.gouv.fr is sent to a port nothing listens on — a network failure, the one
                // case the box's last copy may cover.
                h.io.map({ 'https://www.data.gouv.fr/': 'http://127.0.0.1:9/', 'https://tabular-api.data.gouv.fr/': 'http://127.0.0.1:9/' });
                await open(h);
                const before = await h.computer.call('docId');
                await h.computer.tutorial.openTemplate('analyse-a-dataset');
                await h.waitFor((was) => {
                    const id = window.LolComputer.debug.computer.docId();
                    const d = window.LolComputer.debug.computer.doc();
                    return id && id !== was && d && d.parts.some((p) => p.type === 'opendata') ? id : null;
                }, { timeout: 15000, args: [before] });
                let doc = await h.computer.doc();
                h.eq(doc.title, 'Analyse a dataset', 'a new library document, named for the template');
                const gens = await h.eval(() => (document.querySelector('#lolcomputer .comp-run-gens') || {}).textContent || '');
                h.assert(/\b3\b/.test(gens), `the run bar says what it costs: ${gens}`);

                const byInstr = (/** @type {RegExp} */ re) => doc.parts.find((/** @type {any} */ p) => p.type === 'ask' && re.test(p.settings.instruction)).id;
                await h.computer.set(byInstr(/^Read the facts/), { model: 'mock-echo' });
                await h.computer.set(byInstr(/choose ONE column/), { model: 'mock-studio-json' });
                await h.computer.set(byInstr(/^Write JavaScript/), { model: 'mock-code' });
                await h.mock.state({ codeReply: 'Here it is:\n\n```js\nconst d = inputs.in[0];\nreturn "In the first " + d.read + " rows of " + d.total + ": " + d.rows.filter((r) => r["Discipline dominante"] === "Musique").length + " music festivals.";\n```' });
                await h.click('#lolcomputer .comp-run-all');
                const ids = doc.parts.filter((/** @type {any} */ p) => ['opendata', 'code', 'ask', 'preview'].includes(p.type)).map((/** @type {any} */ p) => p.id);
                doc = await settle(h, ids);
                const notDone = doc.parts.filter((/** @type {any} */ p) => ids.includes(p.id) && p.state !== 'done');
                h.eq(notDone.map((/** @type {any} */ p) => `${p.id}: ${p.error}`), [], 'every box ran');

                const src = doc.parts.find((/** @type {any} */ p) => p.type === 'opendata');
                const face = await h.eval((id) => {
                    const el = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] .graph-fetch-status`);
                    return el ? { text: el.textContent, offline: el.classList.contains('offline') } : null;
                }, src.id);
                h.assert(face && face.offline && /Offline/.test(face.text), `the box says it kept the last copy: ${JSON.stringify(face)}`);

                // A template opens with fresh ids: find each box by what it is.
                const codeBy = (/** @type {RegExp} */ re) => doc.parts.find((/** @type {any} */ p) => p.type === 'code' && re.test(p.settings.about || ''));
                const page = String(codeBy(/^The page/).value.data);
                h.assert(/^# Liste des festivals en France/.test(page) && /\| Discipline dominante \| string \| 100% \| 6 \| Musique \(3229\)/.test(page), `the page carries data.gouv.fr's numbers: ${page.slice(0, 300)}`);
                h.assert(!/The first \d/.test(page.split('## The columns')[0]), 'no digit the model wrote survives in its reading');
                const chart = doc.parts.find((/** @type {any} */ p) => p.type === 'preview' && p.settings.mode === 'svg').id;
                const svg = await h.eval((id) => {
                    const img = document.querySelector(`#lolcomputer .graph-part[data-id="${id}"] img[src^="data:image/svg+xml"]`);
                    return img ? decodeURIComponent(String(img.getAttribute('src')).split(',')[1] || '') : '';
                }, chart);
                h.assert(/counts over all 7283 rows, by data\.gouv\.fr/.test(svg), 'the chart draws data.gouv.fr\'s whole-file counts');
                const music = src.value.data.rows.filter((/** @type {any} */ r) => r['Discipline dominante'] === 'Musique').length;
                h.eq(String(codeBy(/^Runs the program/).value.data), `In the first 20 rows of 7283: ${music} music festivals.`,
                    'the model\'s program ran over the sample, and says so');
            } finally {
                h.io.map(null);
            }
        },
    },
];
