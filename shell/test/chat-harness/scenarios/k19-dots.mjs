// @ts-check
// COMPUTER_DOTS_PLAN (the owner's J21, 2026-11-27: "the inputs should be in the same order of the fields in the box, we
// should have a clearer connection on how they relate. Maybe we should add tooltips when hovering the inputs / outputs").
// In the real browser, with real input:
//   1. On Classify, Filter and Code each input dot sits within 4 px of the middle of the row it fills, and the wire
//      into it ends on it; after a resize, at another zoom, in Filter's Length mode and on a folded Code box too.
//   2. The owner's graph built by dragging wires: a Text box's lines on Classify's items dot runs; a second Text box on
//      the Options dot dims the Options field and names its source; hovering a dot shows its name; a box under a dragged
//      wire shows every dot's name.
// The pure half (the geometry with a measured row, the body-drop order, the wired field) is in chat-unit.js.

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

/** The rows each dot fills, by box type: the same selectors the specs name (classify-part.test.mjs checks them there). */
const ROWS = {
    classify: { items: '.graph-classify-items', question: '.graph-classify-q', options: '.graph-classify-opts' },
    filter: { items: '.graph-filter-items', criterion: '.graph-filter-criterion' },
    code: { in: '.graph-code-in', code: '.graph-code-src' },
};

/** The Computer, shown, on a NEW empty document, at 100 % with the origin top-left. */
async function freshDoc(/** @type {any} */ h, /** @type {string} */ title) {
    await h.view('computer');
    await h.waitFor(() => {
        const d = window.LolComputer && window.LolComputer.debug;
        return d && d.library && typeof d.library.openId === 'function' && d.library.openId() && d.computer ? true : null;
    }, { timeout: 20000 });
    const id = await h.eval((t) => window.LolComputer.debug.library.create(t), title);
    await h.waitFor((want) => (window.LolComputer.debug.computer.docId() === want ? true : null), { args: [id], timeout: 15000 });
    await h.eval(() => {
        const c = window.LolComputer.app.host.canvas;
        c.setView({ x: 0, y: 0, zoom: 1 });
        c.setTool('select');
        c.closePalette();
        return true;
    });
    await frames(h);
    return id;
}

/** A few frames: the canvas's rAF and the row observer have both run. */
const frames = (/** @type {any} */ h) => h.eval(() => new Promise((done) => {
    let n = 0;
    const step = () => (++n >= 4 ? done(true) : requestAnimationFrame(step));
    requestAnimationFrame(step);
}));

const box = (/** @type {string} */ id) => `#lolcomputer .graph-part[data-id="${id}"]`;
const dot = (/** @type {string} */ id, /** @type {string} */ port) => `${box(id)} .graph-port[data-dir="in"][data-port="${port}"]`;
const outDot = (/** @type {string} */ id) => `${box(id)} .graph-port[data-dir="out"]`;

/** For each dot of a box: how far (world px) its centre is from its row's middle, null when the row is not drawn, and
 * whether it is inside the box. */
const offsets = (/** @type {any} */ h, /** @type {string} */ id, /** @type {Record<string, string>} */ rows) => h.eval((sel, map) => {
    const node = document.querySelector(sel);
    const nr = node.getBoundingClientRect();
    const scale = nr.height / node.offsetHeight;
    /** @type {Record<string, {gap: number|null, y: number, inside: boolean}>} */ const out = {};
    for (const [port, rowSel] of Object.entries(map)) {
        const p = node.querySelector(`.graph-port[data-dir="in"][data-port="${port}"]`).getBoundingClientRect();
        const row = node.querySelector(`.graph-part-body ${rowSel}`);
        const rr = row && row.getClientRects().length ? row.getBoundingClientRect() : null;
        const py = p.top + p.height / 2;
        out[port] = {
            gap: rr && rr.height > 0 ? Math.abs(py - (rr.top + rr.height / 2)) / scale : null,
            y: (py - nr.top) / scale,
            inside: py > nr.top && py < nr.bottom,
        };
    }
    return out;
}, box(id), rows);

/** Where the drawn wire into `port` ends, against the dot's centre, in world px. */
const wireGap = (/** @type {any} */ h, /** @type {string} */ to, /** @type {string} */ port) => h.eval((toId, name) => {
    const dbg = window.LolComputer.debug.computer;
    const doc = dbg.doc();
    const w = doc.wires.find((x) => x.to === toId && x.port === name);
    const path = w && document.querySelector(`#lolcomputer .graph-wire[data-wire="${w.id}"]`);
    if (!path) return null;
    const nums = String(path.getAttribute('d')).trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    const endY = nums[nums.length - 1];
    const part = doc.parts.find((p) => p.id === toId);
    const node = document.querySelector(`#lolcomputer .graph-part[data-id="${toId}"]`);
    const port = node.querySelector(`.graph-port[data-dir="in"][data-port="${name}"]`);
    const scale = node.getBoundingClientRect().height / node.offsetHeight;
    const dotY = part.y + (port.getBoundingClientRect().top + port.getBoundingClientRect().height / 2 - node.getBoundingClientRect().top) / scale;
    return Math.abs(endY - dotY);
}, to, port);

export default [
    {
        name: 'k19-dots-sit-beside-the-rows-they-fill',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await freshDoc(h, 'k19 dots');
            const cls = await h.computer.place('classify', 60, 60);
            const fil = await h.computer.place('filter', 460, 60);
            const code = await h.computer.place('code', 820, 60);
            const src = await h.computer.place('note', 60, 420);
            await h.computer.wire(src, cls, 'options');
            await frames(h);

            const check = async (/** @type {string} */ when) => {
                for (const [id, type] of [[cls, 'classify'], [fil, 'filter'], [code, 'code']]) {
                    const got = await offsets(h, id, /** @type {any} */ (ROWS)[type]);
                    for (const [port, o] of Object.entries(got)) {
                        h.assert(o.gap !== null && o.gap <= 4, `${when}: ${type}'s ${port} dot is level with its row (${JSON.stringify(o)})`);
                    }
                }
                const gap = await wireGap(h, cls, 'options');
                h.assert(gap !== null && gap <= 1, `${when}: the wire into Options ends on its dot (${gap})`);
            };
            await check('placed');
            const order = await h.eval((sel) => Array.from(document.querySelectorAll(sel + ' .graph-port[data-dir="in"]'))
                .map((p) => ({ port: p.getAttribute('data-port'), top: p.getBoundingClientRect().top }))
                .sort((a, b) => a.top - b.top).map((p) => p.port), box(cls));
            h.eq(order, ['items', 'question', 'options'], 'Classify\'s dots read top to bottom as its rows do');
            const names = await h.eval((sel) => Array.from(document.querySelectorAll(sel + ' .graph-port-name')).map((n) => n.textContent), box(cls));
            h.eq(names, ['Items', 'Question', 'Options'], 'and each row starts with its dot\'s name');
            await h.screenshot('k19-dots-placed');

            // A taller Classify, by its real handle: the dots follow their rows, not the new height.
            await h.input.drag(`${box(cls)} .graph-part-resize`, await h.eval((s) => {
                const r = document.querySelector(s).getBoundingClientRect();
                return { x: r.left + r.width / 2 + 40, y: r.top + r.height / 2 + 120 };
            }, `${box(cls)} .graph-part-resize`), { steps: 8 });
            await frames(h);
            await check('resized');

            // Another zoom: the measurement is in world units.
            await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 1.5 }); return true; });
            await frames(h);
            await check('at 150 %');
            await h.eval(() => { window.LolComputer.app.host.canvas.setView({ x: 0, y: 0, zoom: 1 }); return true; });

            // Filter in Length mode hides its criterion field: the items dot stays on its row, the other goes below it.
            await h.computer.set(fil, { mode: 'length' });
            await frames(h);
            const len = await offsets(h, fil, ROWS.filter);
            h.assert(len.items.gap !== null && len.items.gap <= 4, `Length mode: the items dot stays on its row (${JSON.stringify(len.items)})`);
            h.eq(len.criterion.gap, null, 'the criterion field is not drawn');
            h.assert(len.criterion.inside && len.criterion.y > len.items.y + 14, `and its dot sits below, inside the box (${JSON.stringify(len.criterion)})`);
            await h.computer.set(fil, { mode: 'contains' });

            // A folded Code box hides its editor: the Inputs dot stays on its row.
            await h.computer.set(code, { folded: true });
            await frames(h);
            const fold = await offsets(h, code, ROWS.code);
            h.assert(fold.in.gap !== null && fold.in.gap <= 4, `folded Code: the Inputs dot stays on its row (${JSON.stringify(fold.in)})`);
            h.assert(fold.code.inside && fold.code.y > fold.in.y + 14, `and the code dot sits below it (${JSON.stringify(fold.code)})`);
            await h.computer.set(code, { folded: false });
            await frames(h);
            await check('unfolded');
        },
    },
    {
        name: 'k19-dots-the-owners-classify-graph-by-dragging-wires',
        needsMock: true,
        timeoutMs: 90000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.computer.classify(true);
            try {
                await freshDoc(h, 'k19 J21');
                const lines = 'Le PSG bat Marseille 3-1\nParliament votes the budget\nLe Sénat rejette la réforme\nShares fall 8%\nA runner wins the marathon';
                const text = await h.computer.place('note', 40, 60);
                await h.computer.set(text, { text: lines });
                const cls = await h.computer.place('classify', 420, 60);
                await h.computer.set(cls, { question: 'What is each item mainly about?', options: 'sports,\npolitics,\nbusiness' });
                await frames(h);

                // Hovering a dot names it, at once (the ::after that draws its glyph).
                await h.input.move(dot(cls, 'options'));
                const hover = await h.eval((s) => getComputedStyle(document.querySelector(s), '::after').content, dot(cls, 'options'));
                h.assert(/Options/.test(hover), `hovering the Options dot names it: ${hover}`);
                // Painted, not only styled: the box's paint containment (graph.css, content-visibility) clips 16 px past its
                // edge, which cut the name to its last letter until the hovered box got a wider clip margin.
                const room = await h.eval((s) => {
                    const port = document.querySelector(s);
                    const label = parseFloat(getComputedStyle(port, '::after').width);
                    const margin = parseFloat(getComputedStyle(port.closest('.graph-part')).overflowClipMargin);
                    return { label, margin, reach: label + 7 + 3 + 12 };
                }, dot(cls, 'options'));
                h.assert(room.margin >= room.reach, `the name is painted whole, not clipped by the box: ${JSON.stringify(room)}`);
                await h.screenshot('k19-dots-hover-options');
                await h.input.move(outDot(text));
                const outHover = await h.eval((s) => getComputedStyle(document.querySelector(s), '::after').content, outDot(text));
                h.assert(/output/.test(outHover) && /text/.test(outHover), `the output dot says what it hands on: ${outHover}`);

                // A box under a dragged wire shows all its dots' names (the canvas marks it data-drop-target).
                const dragging = await h.eval((s) => {
                    const node = document.querySelector(s);
                    node.dataset.dropTarget = 'true';
                    const all = Array.from(node.querySelectorAll('.graph-port[data-dir="in"]')).map((p) => getComputedStyle(p, '::after').content);
                    delete node.dataset.dropTarget;
                    return all;
                }, box(cls));
                h.assert(dragging.length === 3 && dragging.every((c, i) => c.includes(['Items', 'Question', 'Options'][i])), `every dot named while a wire is dragged: ${JSON.stringify(dragging)}`);

                // The owner's wiring, by dragging: the Text box onto the items dot.
                await h.input.drag(outDot(text), dot(cls, 'items'), { steps: 10 });
                await frames(h);
                let doc = await h.computer.doc();
                h.eq(doc.wires.map((/** @type {any} */ w) => w.port), ['items'], 'the drag landed on the items dot');
                const itemsRow = await h.eval((s) => document.querySelector(s + ' .graph-classify-items').textContent, box(cls));
                h.assert(/From the wire: “Text”/.test(itemsRow), `the items row names its source: ${itemsRow}`);

                await h.click('#lolcomputer .comp-run-all');
                await h.waitFor(() => {
                    const dbg = window.LolComputer.debug.computer;
                    return !dbg.running() && dbg.doc().parts.find((p) => p.type === 'classify').state === 'done' ? true : null;
                }, { timeout: 30000 });
                doc = await h.computer.doc();
                const out = doc.parts.find((/** @type {any} */ p) => p.id === cls).value.data;
                h.eq(out.labels.length, 5, 'every line was classified');
                const read = await h.eval((s) => document.querySelector(s + ' .graph-classify-items').textContent, box(cls));
                h.assert(/5 items, from “Text”/.test(read), `the items row says what the run read: ${read}`);
                const fit = await h.eval((s) => {
                    const b = document.querySelector(s + ' .graph-part-body');
                    return { over: b.scrollHeight - b.clientHeight, h: b.closest('.graph-part').offsetHeight };
                }, box(cls));
                h.note(`Classify's body at ${fit.h} px after a run: ${fit.over} px more than it shows`);

                // A second Text box onto the Options dot: the field is dimmed, read-only, and names its source.
                const text2 = await h.computer.place('note', 40, 300);
                await h.computer.set(text2, { text: 'sports\npolitics' });
                await frames(h);
                await h.input.drag(outDot(text2), dot(cls, 'options'), { steps: 10 });
                await frames(h);
                const field = await h.eval((s) => {
                    const el = document.querySelector(s + ' .graph-classify-opts');
                    return { readOnly: el.readOnly, value: el.value, placeholder: el.placeholder, dim: el.classList.contains('graph-from-wire') };
                }, box(cls));
                h.eq([field.readOnly, field.value, field.dim], [true, '', true], `the Options field is the wire's now: ${JSON.stringify(field)}`);
                h.assert(/From the wire: “Text”/.test(field.placeholder), `and it says where they come from: ${field.placeholder}`);
                await h.screenshot('k19-dots-j21-wired');

                // Unplugged: the typed options come back.
                doc = await h.computer.doc();
                const w2 = doc.wires.find((/** @type {any} */ w) => w.port === 'options');
                await h.computer.unwire(w2.id);
                await frames(h);
                const back = await h.eval((s) => {
                    const el = document.querySelector(s + ' .graph-classify-opts');
                    return { readOnly: el.readOnly, value: el.value };
                }, box(cls));
                h.eq(back, { readOnly: false, value: 'sports,\npolitics,\nbusiness' }, 'unplugged: the typed options are back');
            } finally {
                await h.computer.classify(false);
            }
        },
    },
];
