// @ts-check
// Owner, 2026-09-28 (NIGHT_LOG 21:30): the Computer's GRAPH preset — node-link JSON (graphify's
// graph.json) drawn by ONE d3-force viewer (sandbox/graph-view.mjs) with the vendored d3, in the
// real opaque sandbox guest, the farm gone.
//   1. A 5-node graph.json draws: the picture is a painted PNG, and the guest's own SVG holds the
//      5 nodes, the 4 links between them (a 5th, to a node that is not there, is dropped), their
//      labels, and one colour per community. `hyperedges` are ignored, not an error.
//   2. {nodes, edges} past the cap is a sentence in the picture, not a stalled guest.
//   3. A broken JSON fails the box with ITS line, before the guest is asked.
//   4. ▶ Live: a real drag on a node moves the drawing (the pixels change); the canvas does not pan.
// The SVG is read back through the snapshot guest's compute door: the same frame, the same #root.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

const GRAPH = JSON.stringify({
    directed: false, multigraph: false, graph: {},
    nodes: [
        { id: 'a', label: 'Alpha', community: 0, community_name: 'Left' },
        { id: 'b', label: 'Beta', community: 0, community_name: 'Left' },
        { id: 'c', label: 'Gamma', community: 1, community_name: 'Right' },
        { id: 'd', label: 'Delta', community: 1, community_name: 'Right' },
        { id: 'e', label: 'Epsilon', community: 2, community_name: 'Alone' },
    ],
    links: [
        { source: 'a', target: 'b', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1.0 },
        { source: 'b', target: 'c', relation: 'references', confidence: 'INFERRED', confidence_score: 0.85 },
        { source: 'c', target: 'd', relation: 'imports', confidence: 'EXTRACTED', confidence_score: 1.0 },
        { source: 'd', target: 'e', relation: 'conceptually_related_to', confidence: 'AMBIGUOUS', confidence_score: 0.2 },
        { source: 'e', target: 'ghost', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1.0 },
    ],
    hyperedges: [{ id: 'h1', label: 'All of them', nodes: ['a', 'b', 'c'], relation: 'form', confidence: 'INFERRED', confidence_score: 0.75 }],
}, null, 2);

/** The Computer, shown, an empty document open at 100 %, the farm gone. */
async function open(/** @type {any} */ h) {
    await h.view('computer');
    await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
    const d = await h.computer.doc();
    if (d.parts.length) await h.computer.remove(d.parts.map((/** @type {any} */ p) => p.id));
    await h.setFarm(null);
    await h.mock.reset();
    await h.eval(() => {
        const c = window.LolComputer.app.host.canvas;
        c.setView({ x: 0, y: 0, zoom: 1 });
        c.setTool('select');
        c.closePalette();
        return true;
    });
}

/** Wait until a part settles, and return its state. */
const settled = (/** @type {any} */ h, /** @type {string} */ id, timeout = 30000) => h.waitFor((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
    return p && (p.state === 'done' || p.state === 'error') ? { state: p.state, error: p.error || null } : null;
}, { args: [id], timeout });

/** A Graph box (the ＋ menu's preset, placed through the debug door) holding `source`, run with its own ▶. */
async function draw(/** @type {any} */ h, /** @type {string} */ source, w = 400, hh = 300) {
    const id = await h.computer.place('preview', 40, 40);
    await h.computer.set(id, { mode: 'graph', source, w, h: hh });
    await h.computer.play(id);
    return { id, ...(await settled(h, id)) };
}

/** What the snapshot guest's #root holds right now (its SVG, or the sentence it wrote instead). */
const guestDom = (/** @type {any} */ h) => h.eval(async () => {
    const sb = window.LolComputer.debug.computer.session().sandboxNow();
    const out = await sb.compute({
        code: [
            'const root = document.getElementById("root");',
            'const svg = root.querySelector("svg");',
            'const p = root.querySelector("p");',
            'if (!svg) return { svg: false, sentence: p ? p.textContent : null, kind: p ? p.getAttribute("data-graph") : null };',
            'const view = svg.querySelector("g");',
            'const pos = {};',
            'for (const c of svg.querySelectorAll("circle")) pos[c.getAttribute("data-id")] = [Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))];',
            'return {',
            '  svg: true, w: Number(svg.getAttribute("width")), h: Number(svg.getAttribute("height")),',
            '  nodes: svg.querySelectorAll("circle").length, links: svg.querySelectorAll("line").length,',
            '  labels: Array.from(svg.querySelectorAll("text")).map((t) => t.textContent),',
            '  fills: Array.from(new Set(Array.from(svg.querySelectorAll("circle")).map((c) => c.getAttribute("fill")))).length,',
            '  dashed: svg.querySelectorAll("line[stroke-dasharray]").length,',
            '  said: [svg.getAttribute("data-nodes"), svg.getAttribute("data-links")],',
            '  transform: view ? view.getAttribute("transform") : null, pos,',
            '};',
        ].join('\n'),
        timeoutMs: 4000,
    });
    return out.ok ? JSON.parse(out.json) : { error: out.error };
});

/** A box's picture: kind, size and how many distinct colours it holds (an empty PNG proves nothing). */
const pixels = (/** @type {any} */ h, /** @type {string} */ id) => h.eval(async (pid) => {
    const img = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-tile');
    if (!img) return null;
    const src = String(img.getAttribute('src') || '');
    const im = new Image();
    await new Promise((resolve, reject) => { im.onload = resolve; im.onerror = () => reject(new Error('the tile did not decode')); im.src = src; });
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = /** @type {any} */ (c.getContext('2d'));
    g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set();
    for (let i = 0; i < d.length; i += 4 * 5) if (d[i + 3] > 16) colours.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    return { kind: src.slice(5, src.indexOf(';')), w: im.naturalWidth, h: im.naturalHeight, colours: colours.size };
}, id);

const sel = (/** @type {string} */ id, /** @type {string} */ inner) => `#lolcomputer .graph-part[data-id="${id}"]${inner ? ' ' + inner : ''}`;

/** What the live guest shows right now, as a PNG data URL. */
const liveShot = (/** @type {any} */ h) => h.eval(async () => {
    const sb = window.LolComputer.debug.computer.session().sandboxNow();
    const l = sb && sb.liveNow ? sb.liveNow() : null;
    const s = l ? await l.snapshot({ maxPx: 400 }) : null;
    return s ? s.dataUrl : null;
});

/** The share of sampled pixels that differ between two PNGs (0..1). */
const differ = (/** @type {any} */ h, /** @type {string} */ a, /** @type {string} */ b) => h.eval(async (x, y) => {
    const load = (src) => new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => reject(new Error('undecodable')); im.src = src; });
    const [ia, ib] = await Promise.all([load(x), load(y)]);
    const px = (im) => {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
    };
    const da = px(ia), db = px(ib);
    if (da.length !== db.length) return 1;
    let n = 0, d = 0;
    for (let i = 0; i < da.length; i += 4 * 2) {
        n++;
        if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 30) d++;
    }
    return n ? d / n : 0;
}, a, b);

export default [
    {
        name: 'k25-graph-preview-the-menu-graph-box-draws-its-starter-with-no-farm',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const id = await h.computer.add('graph');
            h.assert(!!id, 'clicking "graph" in the ＋ menu placed a box');
            const part = (await h.computer.doc()).parts.find((/** @type {any} */ p) => p.id === id);
            h.eq([part.type, part.settings.mode], ['preview', 'graph'], 'a Preview preset in Graph mode');
            const title = await h.eval((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : ''; }, sel(id, '.graph-part-title'));
            h.assert(/graph/i.test(title), `titled by its name: "${title}"`);
            await h.computer.play(id);
            const out = await settled(h, id);
            h.eq(out.state, 'done', `the starter graph drew with no farm: ${out.error || ''}`);
            const dom = await guestDom(h);
            h.eq([dom.nodes, dom.links, dom.fills], [6, 6, 3], `six nodes, six links, three communities: ${JSON.stringify(dom)}`);
            const saves = await h.eval((s) => Array.from(document.querySelectorAll(s)).filter((b) => !b.hidden).map((b) => b.getAttribute('data-as')), sel(id, '.graph-preview-save'));
            h.eq(saves, ['json', 'png'], 'Save .json and Save .png');
            await h.screenshot('k25-graph-preview-starter');
        },
    },
    {
        name: 'k25-graph-preview-a-graphify-graph-json-draws-its-nodes-links-and-communities',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const a = await draw(h, GRAPH, 400, 300);
            h.eq(a.state, 'done', `the graph drew: ${a.error || ''}`);
            const px = await pixels(h, a.id);
            h.assert(px && px.kind === 'image/png', `a PNG came back: ${JSON.stringify(px)}`);
            h.eq([px.w, px.h], [400, 300], 'at the box\'s Width x Height');
            h.assert(px.colours >= 4, `and it is painted — paper, links, three community colours — not blank (${px.colours} colours)`);

            const dom = await guestDom(h);
            h.eq(dom.svg, true, `the guest holds an SVG: ${JSON.stringify(dom)}`);
            h.eq([dom.w, dom.h], [400, 300], 'fitted to the box');
            h.eq(dom.nodes, 5, 'five nodes');
            h.eq(dom.links, 4, 'four links: the one to a missing node is dropped');
            h.eq(dom.said, ['5', '4'], 'the SVG says what it drew');
            h.eq(dom.labels.slice().sort(), ['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma'], 'every node is labelled');
            h.eq(dom.fills, 3, 'one colour per community');
            h.eq(dom.dashed, 2, 'the INFERRED and the AMBIGUOUS link are dashed; the EXTRACTED ones solid');
            for (const [id, [x, y]] of Object.entries(dom.pos)) h.assert(Number.isFinite(x) && Number.isFinite(y), `node ${id} has a place: ${x},${y}`);
            h.assert(/^translate\(/.test(String(dom.transform)), `the layout is fitted by one transform: ${dom.transform}`);
            await h.screenshot('k25-graph-preview');
            h.note(`5 nodes, 4 links, ${px.colours} colours in the picture; ${dom.transform}`);
        },
    },
    {
        name: 'k25-graph-preview-past-the-cap-a-sentence-and-a-broken-json-names-its-line',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const big = JSON.stringify({ nodes: Array.from({ length: 1200 }, (_, i) => ({ id: `n${i}` })), edges: [] });
            const a = await draw(h, big);
            h.eq(a.state, 'done', `a too-big graph is not a failure: ${a.error || ''}`);
            const dom = await guestDom(h);
            h.eq([dom.svg, dom.kind], [false, 'too-many'], `a sentence instead of a layout: ${JSON.stringify(dom)}`);
            const want = await h.eval(() => window.LolComputer.app.t('parts.previewGraphTooMany', { nodes: 1200, links: 0, maxNodes: 1000, maxLinks: 5000 }));
            h.eq(dom.sentence, want, 'the sentence says how big it is and what the box draws');
            h.assert(await pixels(h, a.id), 'and the picture shows it');

            const b = await draw(h, '{\n  "nodes": [\n    {"id": "a"}\n    {"id": "b"}\n  ]\n}');
            h.eq(b.state, 'error', 'a broken JSON fails the box');
            h.assert(/line 4/.test(String(b.error && (b.error.message || b.error))), `and names the line it breaks on: ${JSON.stringify(b.error)}`);
            const line = await h.eval((s) => { const e = document.querySelector(s); return e ? e.getAttribute('data-line') : null; }, sel(b.id, '.graph-preview-error'));
            h.eq(line, '4', '"Go to line" points at it');
        },
    },
    {
        name: 'k25-graph-preview-live-a-drag-on-a-node-moves-the-drawing',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await open(h);
            const a = await draw(h, GRAPH, 400, 300);
            h.eq(a.state, 'done', `the graph drew: ${a.error || ''}`);
            // Where node "a" sits in the frame: the layout is deterministic, so the snapshot's is the live one's.
            const dom = await guestDom(h);
            const m = /translate\(([-\d.e]+),\s*([-\d.e]+)\)\s*scale\(([-\d.e]+)\)/.exec(String(dom.transform));
            h.assert(m, `the fit transform reads: ${dom.transform}`);
            const [tx, ty, k] = [Number(m[1]), Number(m[2]), Number(m[3])];
            const [cx, cy] = dom.pos.a;

            await h.input.click(sel(a.id, '.graph-preview-live'));
            await h.waitFor((s) => {
                const sb = window.LolComputer.debug.computer.session().sandboxNow();
                const l = sb && sb.liveNow ? sb.liveNow() : null;
                const fr = document.querySelector(s + ' .graph-preview-stage .sandbox-live-frame');
                return l && fr && l.state() === 'running' ? true : null;
            }, { args: [sel(a.id, '')], timeout: 20000 });
            await h.eval(() => new Promise((done) => setTimeout(done, 400)));
            const before = await liveShot(h);
            h.assert(before, 'the live graph can be photographed');
            const v0 = await h.eval(() => window.LolComputer.debug.computer.view());

            const r = await h.eval((s) => {
                const fr = document.querySelector(s + ' .sandbox-live-frame');
                const b = fr ? fr.getBoundingClientRect() : null;
                return b ? { left: b.left, top: b.top, width: b.width, height: b.height } : null;
            }, sel(a.id, ''));
            h.assert(r && r.width > 100, `the live frame is on the box: ${JSON.stringify(r)}`);
            const at = { x: r.left + ((tx + cx * k) * r.width) / 400, y: r.top + ((ty + cy * k) * r.height) / 300 };
            await h.input.drag(at, { x: at.x + 80, y: at.y + 50 }, { steps: 12 });
            await h.eval(() => new Promise((done) => setTimeout(done, 700)));
            const after = await liveShot(h);
            const moved = await differ(h, before, after);
            h.assert(moved > 0.005, `a drag on a node moved the drawing: ${(moved * 100).toFixed(2)} % of the pixels changed`);
            h.eq(await h.eval(() => window.LolComputer.debug.computer.view()), v0, 'and the canvas did not pan or zoom');
            await h.screenshot('k25-graph-preview-live');
            await h.input.click(sel(a.id, '.graph-preview-live'));
            h.note(`dragged node a from ${Math.round(at.x)},${Math.round(at.y)}: ${(moved * 100).toFixed(2)} % changed`);
        },
    },
];
