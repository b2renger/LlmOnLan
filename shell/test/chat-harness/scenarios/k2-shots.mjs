// @ts-check
// The K2 landing's LOOK (integrator-owned, like c1-shots / c2-shots): a graph whose ARROWS ARE
// NAMED, an Instruction that binds them, and the transcript drawer showing what will be sent.
//
// What has to be IN the picture: two labelled wires (the pill carries the reader's own spelling)
// and one unnamed arrow (the dashed "name me" plea), an Instruction box with its "sends N words ·
// M named inputs" strip and its `unused:` chip, and the drawer open on the Sent tab with the
// prompt in it. Everything the phase added is either in this frame or invisible to the user.
//
// The assertions are the part that survives a screenshot nobody looks at: the pills sit ON their
// wires inside the canvas, the drawer is a readable column that does not cover the canvas whole,
// the strip reads as text, and the page never scrolls sideways.

import fs from 'node:fs';
import path from 'node:path';

const FARM_ERRORS = [/Failed to load resource/, /net::ERR_/];

const requireReal = (/** @type {any} */ h) => h.eval(() => {
    const failed = (window.LolComputer && window.LolComputer.failed) || {};
    const missing = ['host', 'ask', 'library', 'drawer'].filter((k) => failed[k]);
    if (missing.length) throw new Error('k2-shots needs the REAL modules, but the loader dropped: ' + missing.join(', '));
    return true;
});

/** Three notes into one Instruction: two arrows named, one left unnamed on purpose. */
async function buildScene(/** @type {any} */ h) {
    await h.fresh();
    await h.view('computer');
    await requireReal(h);
    await h.waitFor(() => (window.__lolFarm ? true : null));
    await h.waitFor(() => ((window.LolComputer.debug.computer.doc() || {}).id ? true : null));

    const topic = await h.computer.place('note', 20, 20);
    const societal = await h.computer.place('note', 20, 180);
    const country = await h.computer.place('note', 20, 340);
    const aside = await h.computer.place('note', 20, 500);
    const ask = await h.computer.place('ask', 380, 160);
    await h.computer.set(topic, { text: 'accessibility in museums for autistic persons' });
    await h.computer.set(societal, { text: 'Visitors report that quiet hours change everything.' });
    await h.computer.set(country, { text: 'France' });
    await h.computer.set(aside, { text: 'Field notes from the Lyon visit.' });
    await h.computer.set(ask, {
        instruction: 'Write a problematic about the topic, taking the societal research into account.',
        model: 'mock-echo',
    });

    const w1 = await h.computer.wire(topic, ask, 'in');
    const w2 = await h.computer.wire(societal, ask, 'in');
    const w3 = await h.computer.wire(country, ask, 'in');
    const w4 = await h.computer.wire(aside, ask, 'in');
    h.assert(w1.ok && w2.ok && w3.ok && w4.ok, 'the four arrows were drawn');
    h.eq(await h.computer.label(w1.id, 'topic'), true, 'the first arrow took its name');
    h.eq(await h.computer.label(w2.id, 'societal research'), true, 'and so did the second');
    // `country` is named but the instruction never mentions it — rule 4, the `unused:` chip.
    h.eq(await h.computer.label(w3.id, 'country'), true, 'the third arrow took its name');
    // w4 stays unnamed: the dashed plea has to be in the picture too.

    const report = await h.computer.run();
    h.eq(report.errors.length, 0, 'the photographed run failed: ' + JSON.stringify(report.errors));
    // The library card is written by the debounced save (500 ms). Photographing before it lands
    // shows "0 parts · never run" beside a five-part graph, which is a lie about the product.
    await h.computer.save();
    await h.waitFor(() => {
        const card = document.querySelector('#lolcomputer .comp-list .comp-card');
        return card && /\d+\s*part/.test(card.textContent || '') && !/0\s*parts/.test(card.textContent || '') ? true : null;
    }, { timeout: 8000 });
    await h.computer.transcript.open(ask, 'sent');
    return { topic, societal, country, aside, ask };
}

const inspect = () => {
    const q = (/** @type {string} */ s) => document.querySelector(s);
    const rect = (/** @type {any} */ el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const canvas = q('#lolcomputer .graph-canvas');
    const drawer = q('#lolcomputer .comp-drawer');
    return {
        theme: document.documentElement.className,
        canvasRect: rect(canvas),
        pills: Array.from(document.querySelectorAll('#lolcomputer .graph-wire-pill')).map((el) => ({
            text: ((el.querySelector('.graph-wire-label') || {}).textContent || '').trim(),
            placeholder: ((el.querySelector('.graph-wire-ph') || {}).textContent || '').trim(),
            empty: el.getAttribute('data-empty'),
            rect: rect(el),
        })),
        strip: ((q('#lolcomputer .graph-ins-strip') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        chips: Array.from(document.querySelectorAll('#lolcomputer .graph-ins-chip')).map((el) => (el.textContent || '').trim()),
        drawerOpen: !!drawer && !drawer.classList.contains('hidden') && rect(drawer).w > 0,
        drawerRect: rect(drawer),
        drawerTabs: Array.from(document.querySelectorAll('#lolcomputer .comp-drawer [role="tab"], #lolcomputer .comp-tx-tab'))
            .map((el) => (el.textContent || '').trim()).filter(Boolean),
        drawerText: ((drawer && drawer.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 1200),
        docScrollX: document.documentElement.scrollWidth,
        viewportW: window.innerWidth,
        viewportH: window.innerHeight,
    };
};

function check(/** @type {any} */ h, /** @type {any} */ m, /** @type {string} */ theme) {
    h.eq(m.theme, theme, 'the <html> class did not switch');
    h.assert(m.canvasRect && m.canvasRect.h > 200, 'the canvas is only ' + (m.canvasRect && m.canvasRect.h) + ' px tall');

    h.eq(m.pills.length, 4, 'one pill per arrow (' + JSON.stringify(m.pills.map((/** @type {any} */ p) => p.text)) + ')');
    const named = m.pills.filter((/** @type {any} */ p) => p.text);
    h.eq(named.map((/** @type {any} */ p) => p.text).sort().join('|'), 'country|societal research|topic',
        'the three names are on the wires, spelled as they were typed');
    const unnamed = m.pills.filter((/** @type {any} */ p) => !p.text);
    h.eq(unnamed.length, 1, 'exactly one arrow is still unnamed');
    h.assert(unnamed[0].placeholder.length > 0, 'the unnamed arrow shows no plea to name it');
    for (const p of m.pills) {
        h.assert(p.rect.w > 20 && p.rect.h > 10, 'a pill collapsed to ' + p.rect.w + 'x' + p.rect.h);
        h.assert(p.rect.x >= m.canvasRect.x - 1 && p.rect.x + p.rect.w <= m.canvasRect.x + m.canvasRect.w + 1,
            'a pill is painted outside the canvas: ' + JSON.stringify(p.rect));
    }

    h.assert(/[A-Za-z]/.test(m.strip), 'the Instruction strip carries no readable text: "' + m.strip + '"');
    h.assert(m.chips.some((/** @type {string} */ c) => /[A-Za-z]/.test(c)),
        'no chip reported the unused/unwired names: ' + JSON.stringify(m.chips));

    h.eq(m.drawerOpen, true, 'the transcript drawer is not open in the picture');
    h.assert(m.drawerRect.w > 200, 'the drawer is only ' + m.drawerRect.w + ' px wide');
    h.assert(m.drawerRect.w < m.viewportW * 0.75, 'the drawer covers the canvas (' + m.drawerRect.w + ' of ' + m.viewportW + ')');
    h.assert(m.drawerText.includes('societal research'),
        'the Sent tab does not show the named input: "' + m.drawerText + '"');
    h.assert(m.docScrollX <= m.viewportW, 'the page scrolls sideways (' + m.docScrollX + ' > ' + m.viewportW + ')');
}

async function shoot(/** @type {any} */ h, /** @type {string} */ name) {
    const shot = await h.screenshot(name);
    h.assert(!!shot, name + ': no screenshot was produced');
    const size = fs.statSync(shot).size;
    h.assert(size > 4000, name + ': the screenshot is only ' + size + ' bytes — the window painted nothing');
    h.note('screenshot ' + path.basename(shot) + ' (' + size + ' bytes)');
}

export default [
    {
        name: 'k2-shots-dark',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await buildScene(h);
            await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            await new Promise((r) => setTimeout(r, 200));
            const m = await h.eval(inspect);
            check(h, m, 'dark');
            h.note('dark: strip "' + m.strip + '" · chips ' + JSON.stringify(m.chips)
                + ' · pills ' + JSON.stringify(m.pills.map((/** @type {any} */ p) => p.text || p.placeholder)));
            await shoot(h, 'k2-shots-dark');
        },
    },
    {
        name: 'k2-shots-light',
        needsMock: true,
        timeoutMs: 120000,
        allowConsoleErrors: FARM_ERRORS,
        run: async (/** @type {any} */ h) => {
            await buildScene(h);
            try {
                await h.eval(() => { document.documentElement.className = 'light'; return true; });
                await new Promise((r) => setTimeout(r, 200));
                const m = await h.eval(inspect);
                check(h, m, 'light');
                h.note('light: drawer ' + JSON.stringify(m.drawerRect));
                await shoot(h, 'k2-shots-light');
            } finally {
                await h.eval(() => { document.documentElement.className = 'dark'; return true; });
            }
        },
    },
];
