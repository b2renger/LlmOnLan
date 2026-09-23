// @ts-check
// K5 landing: the phase photographed the way the owner will first meet it — three creative boxes
// (p5.js sketch, three.js scene, SVG) placed BY CLICKING the toolbar's ＋ and their rows, each
// drawn by its own ▶ with the farm GONE, then the ＋ menu opened again over them. Measured before
// it is photographed, in both themes: the menu is whole inside the graph and shows its five
// groups, every row carries a glyph and a description, and each box holds a real picture.

import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];
const GROUPS = ['bring', 'think', 'show', 'control', 'annotate'];

const settle = (/** @type {any} */ h) => h.eval(() => new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done(true)));
}));

const settled = (/** @type {any} */ h, /** @type {string} */ id, timeout = 45000) => h.waitFor((pid) => {
    const p = window.LolComputer.debug.computer.doc().parts.find((/** @type {any} */ x) => x.id === pid);
    return p && (p.state === 'done' || p.state === 'error') ? { state: p.state, error: p.error || null } : null;
}, { args: [id], timeout });

/** Decode a box's tile: how many colours, how much of it is opaque. */
const picture = (/** @type {any} */ h, /** @type {string} */ id) => h.eval(async (pid) => {
    const img = document.querySelector('#lolcomputer .graph-part[data-id="' + pid + '"] .graph-preview-tile');
    if (!img) return null;
    const im = new Image();
    await new Promise((resolve, reject) => { im.onload = resolve; im.onerror = () => reject(new Error('no decode')); im.src = String(img.getAttribute('src') || ''); });
    const c = document.createElement('canvas');
    c.width = 160; c.height = 120;
    const g = /** @type {any} */ (c.getContext('2d'));
    g.drawImage(im, 0, 0, 160, 120);
    const d = g.getImageData(0, 0, 160, 120).data;
    const colours = new Set();
    let opaque = 0;
    for (let i = 0; i < d.length; i += 16) {
        if (d[i + 3] > 16) { opaque++; colours.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)); }
    }
    return { opaque, colours: colours.size };
}, id);

/** What the open menu and the boxes look like, measured. */
const measure = (/** @type {any} */ h) => h.eval(() => {
    const r = (/** @type {any} */ el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const menu = document.querySelector('#lolcomputer .graph-add-menu:not([hidden])');
    const canvas = document.querySelector('#lolcomputer .graph');   // the graph root the menu lives in (it hangs from the toolbar's ＋)
    const rows = menu ? Array.from(menu.querySelectorAll('.graph-add-item')) : [];
    return {
        theme: document.documentElement.className,
        menu: menu ? r(menu) : null,
        canvas: canvas ? r(canvas) : null,
        groups: menu ? Array.from(menu.querySelectorAll('.graph-add-group')).map((g) => g.getAttribute('data-group')) : [],
        rows: rows.length,
        bare: rows.filter((el) => !((el.querySelector('.graph-add-glyph') || {}).textContent || '').trim()
            || !((el.querySelector('.graph-add-desc') || {}).textContent || '').trim()).map((el) => el.getAttribute('data-entry')),
        searchFocused: !!menu && document.activeElement === menu.querySelector('.graph-add-search'),
        scrollX: document.documentElement.scrollWidth - window.innerWidth,
    };
});

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
    const shot = await h.screenshot(name);
    h.assert(!!shot, name + ': no screenshot was produced');
    const size = fs.statSync(shot).size;
    h.assert(size > 4000, name + ': the screenshot is only ' + size + ' bytes');
    h.note('screenshot ' + path.basename(shot) + ' (' + size + ' bytes)');
}

export default [
    {
        name: 'k5-shots-menu-over-drawn-creative-boxes',
        needsMock: true,
        timeoutMs: 240000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.view('computer');
            await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
            await h.mock.reset();
            await h.setFarm(null);

            /** @type {Record<string, string>} */ const ids = {};
            for (const [i, entry] of ['p5', 'three', 'svg'].entries()) {
                ids[entry] = await h.computer.add(entry);          // ＋ → click the row
                h.assert(ids[entry], `the ＋ menu placed a ${entry} box`);
                await h.computer.move(ids[entry], 40 + i * 420, 40);
            }
            for (const entry of Object.keys(ids)) {
                await h.computer.play(ids[entry]);
                const s = await settled(h, ids[entry]);
                h.eq(s.state, 'done', `${entry} drew with no farm: ${s.error || ''}`);
                const px = await picture(h, ids[entry]);
                h.assert(px && px.opaque > 0 && px.colours >= 2, `${entry} holds a real picture: ${JSON.stringify(px)}`);
            }
            await h.computer.call('fit');
            await settle(h);

            try {
                for (const theme of ['dark', 'light']) {
                    await h.eval((t) => { document.documentElement.className = t; return true; }, theme);
                    const rows = await h.computer.menu.open();
                    h.assert(rows.length >= 20, `${theme}: the menu shows ${rows.length} rows`);
                    await settle(h);
                    const m = await measure(h);
                    h.eq(m.groups.join(','), GROUPS.join(','), `${theme}: the five groups, in order`);
                    h.eq(m.bare.length, 0, `${theme}: rows without a glyph or a description: ${m.bare.join(', ')}`);
                    h.assert(m.menu && m.canvas && m.menu.l >= m.canvas.l - 1 && m.menu.t >= m.canvas.t - 1
                        && m.menu.r <= m.canvas.r + 1 && m.menu.b <= m.canvas.b + 1,
                        `${theme}: the menu is whole inside the graph: ${JSON.stringify(m.menu)} in ${JSON.stringify(m.canvas)}`);
                    h.assert(m.scrollX <= 0, `${theme}: the page scrolls sideways by ${m.scrollX}px`);
                    await shoot(h, `k5-shots-${theme}`);
                    await h.computer.menu.key('Escape');
                    h.eq(await h.computer.menu.isOpen(), false, `${theme}: Escape closes the menu`);
                }
            } finally {
                await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            }
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'not one generation');
        },
    },

    {
        // Every lesson and template on the Learn shelf, opened by CLICKING its row, photographed as
        // a person first sees it — so the landing can look at each authored layout, not only
        // measure it (k5-lessons measures).
        name: 'k5-shots-every-lesson-and-template-as-opened',
        needsMock: true,
        timeoutMs: 240000,
        allowConsoleErrors: FARM_ERRORS,
        async run(/** @type {any} */ h) {
            await h.fresh();
            await h.view('computer');
            await h.waitFor(() => (window.LolComputer.debug.computer.docId() ? true : null), { timeout: 20000 });
            await h.mock.reset();
            const shelf = [
                ...['l00-tour', 'l01-hello-farm', 'l02-wires', 'l03-labels', 'l04-draw'].map((id) => ({ kind: 'lesson', id })),
                ...['research-problematic', 'creative-coding'].map((id) => ({ kind: 'template', id })),
            ];
            for (const row of shelf) {
                const before = await h.eval(() => window.LolComputer.debug.computer.docId());
                if (row.kind === 'lesson') await h.computer.tutorial.openLesson(row.id);
                else await h.computer.tutorial.openTemplate(row.id);
                await h.waitFor((was) => {
                    const id = window.LolComputer.debug.computer.docId();
                    return id && id !== was ? id : null;
                }, { args: [before], timeout: 15000 });
                await settle(h);
                await settle(h);
                const n = (await h.computer.doc()).parts.length;
                h.assert(n > 0, `${row.id} opened with ${n} boxes`);
                await shoot(h, `k5-shots-${row.id}`);
            }
            h.eq((await h.mock.log({ path: '/v1/chat/completions' })).length, 0, 'opening a lesson spends nothing');
        },
    },
];
